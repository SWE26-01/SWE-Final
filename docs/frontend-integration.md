# 프론트 연결 가이드

`frontend/`(시뮬레이터 화면)를 실제 시스템에 연결하는 방법이다. 화면은 데이터를 **`services/`의 Gateway와 Collector에서만 읽는다.**
에이전트나 Home Assistant에 직접 붙지 않는다.

| 화면에 필요한 것 | 어디서 | 방식 |
|---|---|---|
| 기기 상태 (켜짐·꺼짐, 조명 모드 …) | Device Gateway | WebSocket `/ws`, 처음 한 번 `GET /devices` |
| 에이전트 통신 로그 | Event Collector | WebSocket `/ws` (최근 기록 + 실시간) |
| 요청 하나의 흐름 (누가 요청 → 누가 받음 → 결과) | Event Collector | `GET /flows`, `GET /flows/{flow}` |

## 1. 실행

```bash
scripts/run_all.sh                     # HA + Gateway(8100) + Collector(8200) + 에이전트 5개
cd frontend && npm ci && npm run dev   # http://localhost:5173

# 화면에 데이터가 흐르게 하려면 (다른 터미널)
scripts/scenario.sh                                                     # 정해진 요청들
scripts/oc.sh desktop agent --agent main --message "나 회의 시작할게"     # 사람 말로 (LLM)
```

시스템을 띄우지 않고 화면만 만들 때는 [6. 샘플 데이터](#6-샘플-데이터)를 쓴다.

## 2. 접속

- **토큰**: 루트 `.env`의 `DASHBOARD_TOKEN`. **읽기 전용**이라 이 토큰으로 기기 명령을 보내면 403이다.
- `frontend/.env.local`에 넣는다. `*.local`은 git에서 제외돼 있다.
  ```bash
  VITE_DASHBOARD_TOKEN=<루트 .env의 DASHBOARD_TOKEN>
  ```
- HTTP는 `Authorization: Bearer <토큰>` 헤더를 쓴다. 브라우저 WebSocket은 헤더를 못 붙여서 주소 뒤에 `?token=<토큰>`을 붙인다.

### 방법 1: Vite 프록시 (추천)

`frontend/vite.config.js`를 만든다. 브라우저는 같은 출처(5173)만 부르므로 CORS 설정이 필요 없다.
(2026-10-18에 이 설정 그대로 HTTP·WebSocket 모두 연결되는 것을 확인했다.)

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const strip = (prefix) => (path) => path.replace(new RegExp(`^${prefix}`), '');

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: ['..'] }, // lets the dev server load ../services/contracts/examples/*.json
    proxy: {
      '/gateway': { target: 'http://127.0.0.1:8100', ws: true, rewrite: strip('/gateway') },
      '/collector': { target: 'http://127.0.0.1:8200', ws: true, rewrite: strip('/collector') },
    },
  },
});
```

```js
const token = import.meta.env.VITE_DASHBOARD_TOKEN;
const wsBase = location.origin.replace(/^http/, 'ws');
const gatewayWs = new WebSocket(`${wsBase}/gateway/ws?token=${token}`);
const collectorWs = new WebSocket(`${wsBase}/collector/ws?token=${token}`);
const flows = await fetch('/collector/flows?limit=20', {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());
```

### 방법 2: 직접 접속

루트 `.env`에 `AMBIENT_CORS_ORIGINS=http://localhost:5173`을 넣고 services를 다시 띄운다(`scripts/run_all.sh` 또는 `cd services && docker compose up -d`).
그다음 `http://127.0.0.1:8100`, `http://127.0.0.1:8200`을 바로 부른다. GET만 허용된다.

### 끊겼을 때

- 두 WebSocket 모두 끊기면 1초, 2초, 4초 … 최대 10초 간격으로 다시 연결한다.
- 다시 붙으면 서버가 `snapshot`을 다시 보낸다. 받은 상태를 **통째로 교체**하면 된다.
- Gateway는 Home Assistant와 다시 연결될 때도 `snapshot`을 보낸다.
- `snapshot.ha_connected`가 `false`면 "기기 연결 끊김"으로 표시한다.
- Collector는 화면이 너무 늦게 읽어 쌓이면 연결을 닫는다(코드 1013). 이것도 다시 연결하면 된다.

## 3. 받는 메시지

형식의 정의는 `services/contracts/`에 있고, 실제로 받은 예시는 `services/contracts/examples/`에 있다.

### Gateway `/ws`
- **접속 직후** `{"type": "snapshot", "ha_connected": true, "devices": [...]}` → `gateway-snapshot.json`
- **기기가 바뀔 때마다** `{"type": "device.state_changed", "at": "...", "device": {...}, "previous": "normal"}` → `gateway-state-changed.json`
- 기기 하나(`device`)의 모양:
  ```json
  {"entity": "input_select.room1_light_mode", "space": "my_room", "owner": "room1", "state": "meeting",
   "attributes": {"friendly_name": "내 방 조명 모드", "options": ["normal", "meeting", "eco"]},
   "last_changed": "2026-10-18T07:53:35.590Z"}
  ```
  - `attributes.friendly_name`이 한글 기기 이름이라 화면 표시에 바로 쓸 수 있다.
  - `state`는 `on`/`off`, 또는 선택값이다. HA가 모르는 기기는 `null`이다.
- `GET /devices`는 `devices`와 같은 목록을 준다 → `gateway-devices.json`

### Collector `/ws`
- **접속 직후** `{"type": "snapshot", "events": [...최근 200개]}` → `collector-snapshot.json`
- **새 기록마다** `{"type": "event", "event": {...}}` → `collector-event.json`
- 기록 한 줄(`event`)의 항목:

  | 항목 | 뜻 |
  |---|---|
  | `id` | Collector에 **도착한** 순서 |
  | `ts` | 실제로 **일어난** 시각. 화면 표시와 정렬은 이걸로 |
  | `agent` | 기록을 남긴 에이전트 |
  | `dir` | `in` 받은 요청과 그 답, `out` 보낸 요청, `out-result` 보낸 요청의 결과, `out-error` 보내기 실패, `exec` 자기 기기 실행, `rule` 자동화 규칙 실행 |
  | `to`, `from` | 상대 에이전트. `out*`은 `to`, `in`은 `from` |
  | `type` | 메시지 종류: `device.control`, `context.update`, `context.query`, `context.subscribe` … |
  | `action` | `{device, command, value}` 또는 `{macro}`. `command`는 `TURN_ON`/`TURN_OFF`/`SET`/`ENERGY_SAVING` |
  | `accepted`, `reason_code` | 결과와 사유 (`in`, `out-result`, `exec`, `rule`에 있음) |
  | `request_id`, `flow` | 요청 ID와 그 요청의 흐름 ID |
  | `on_behalf_of` | Home이 넘겨줄 때 원래 요청자 |
  | `fields` | 맥락 조회·구독에서 요청한 항목 이름 (값은 없음) |
  | `message`, `rule`, `error` | 사람이 읽는 설명 (최대 300자) |

- 맥락 값(일정 제목, 위치 등)은 기록에 **일부러 없다**.

### Collector `/flows`
- `GET /flows?limit=20`: 최근에 움직인 요청부터 → `flows.json`
  ```json
  {"flow": "demo-meeting", "requester": "desktop", "entry": "orchestrator", "agents": ["orchestrator", "room1"],
   "action": {"device": "input_select.room1_light_mode", "command": "SET", "value": "meeting", "macro": null},
   "accepted": true, "reason_code": "OK", "events": 5,
   "started_at": "...", "ended_at": "...", "first_id": 95, "last_id": 99}
  ```
- `GET /flows/{flow}`: `{"flow": 요약, "events": [실제 시각 순]}` → `flow-detail.json`
- 새 `event`에 `flow`가 있으면 그 흐름만 다시 불러오면 된다.

## 4. 화면에 대응시키기 (제안)

### 방과 기기

| 화면 방 (`rooms[].id`) | 실제 공간 | 화면 기기 ↔ 실제 엔티티 |
|---|---|---|
| `living` 거실 | `living_room` (Home Agent) | `living-light` ↔ `input_boolean.living_light`, `living-tv` ↔ `input_boolean.living_tv`. `input_boolean.living_tv_muted`는 TV의 `value`에 "음소거"로 표시 |
| `bedroom3` 침실 3 (책상·PC) | `my_room` (My Room Agent) | `bedroom3-light` ↔ `input_boolean.room1_light`(+ `input_select.room1_light_mode`를 `value`에), `bedroom3-air` ↔ `input_boolean.room1_ac`. `input_boolean.room1_occupied`는 재실 표시 |
| `bedroom2` 침실 2 | `protected_room` (room2) | `bedroom2-light` ↔ `input_boolean.room2_light`, `bedroom2-air` ↔ `input_boolean.room2_ac`. `input_boolean.room2_sleep_mode`는 "수면 중" 표시 |
| 주방·다이닝·베란다·욕실·침실 1 | 없음 | 실제 기기가 없음. `connected: false` 또는 "시뮬레이션 전용" |

값 표시 예:
- `on`/`off` → 화면 기기의 `on: true/false`
- `room1_light_mode`: `normal` → "일반", `meeting` → "회의 모드", `eco` → "절전"

### 에이전트 이름

| ID | 화면 이름 |
|---|---|
| `desktop` | Desktop Agent |
| `smartphone` | Mobile Agent |
| `orchestrator` | Home Agent |
| `room1` | My Room Agent |
| `room2` | 보호 방 Agent |

### 기록 한 줄 → 로그 문장

통신 로그(`logs`, `liveMessages`: `{time, from, to, text}`)에는 **`dir: "in"` 기록**을 쓰면 편하다. 받은 쪽 기록이라 결과까지 들어 있다.
- `from` → `to`(= `agent`)
- 문장 = 요청 내용 + 결과
- 시각 = `ts`를 현지 시각 `HH:MM:SS`로

| 항목 | 문구 |
|---|---|
| `type` | `context.update` 상태 공유, `context.query` 상태 조회, `context.subscribe` 구독 신청, `device.control` 기기 제어 |
| `command` | `TURN_ON` 켜기, `TURN_OFF` 끄기, `SET` "`value`로 설정", `ENERGY_SAVING` 절전 |
| 기기 이름 | Gateway의 `attributes.friendly_name` |
| `reason_code` | `OK` 수락, `PARTIAL` 일부만 수락, `UNAUTHORIZED` 권한 없음, `FIELD_NOT_ALLOWED` 공개 안 된 항목, `STALE` 오래된 정보, `NOT_OWNER` 담당 기기 아님, `SAFETY_POLICY` 안전 정책, `PEER_UNREACHABLE` 상대 응답 없음, `EXECUTION_FAILED` 실행 실패, `BAD_REQUEST` 잘못된 요청 |

예: `{"agent": "room1", "dir": "in", "from": "orchestrator", "type": "device.control", "action": {"device": "input_select.room1_light_mode", "command": "SET", "value": "meeting"}, "accepted": true, "reason_code": "OK"}`
→ "Home Agent → My Room Agent · 내 방 조명 모드 meeting로 설정 · 수락"

`exec`(실행)와 `rule`(자동화 규칙)은 활동 타임라인에 넣는다. 예: "My Room Agent · 회의 시작 감지 → 조명 회의 모드".

### 요청 카드 (Agent Decision / Activity)

`/flows`의 요약 하나가 카드 하나다.
- 제목: `action`을 위 규칙대로 쓴 문장
- 경로: `requester` → `entry` → `agents`의 나머지
- 결과: `accepted` + `reason_code` 배지
- 자세히: `/flows/{flow}`의 `events`를 시간순으로

팀에서 예측 모델은 빼기로 했으니, 예측(%) 문구는 실제 데이터 화면에서 숨긴다.

## 5. 주의

- **화면에서 기기를 조작하지 않는다.** 대시보드 토큰은 읽기 전용이다(명령 → 403). 실제 데이터 화면에서는 기기 켜기·끄기 버튼을 비활성화한다.
  화면에서 시나리오를 실행하는 버튼이 필요하면 services에 별도 API를 만들어야 한다.
- 토큰은 `frontend/.env.local`에만 두고 커밋하지 않는다.
- 정렬과 시각은 `ts`를 쓴다. `id`는 도착 순이다.
- 가짜 시나리오 화면은 오프라인 데모용으로 남겨 두고, 실제 데이터와 전환하는 방식(Mock / Live)을 두는 것을 추천한다.

## 6. 샘플 데이터

`services/contracts/examples/`의 JSON은 2026-10-18 실제 시스템에서 받은 그대로다. 시스템 없이 화면을 만들 때 그대로 불러 쓴다.
Vite에서는 `import snapshot from '../../services/contracts/examples/gateway-snapshot.json'`처럼 불러온다. `frontend/` 밖 파일이라 위 설정의 `fs.allow`가 필요하다.

| 파일 | 내용 |
|---|---|
| `gateway-snapshot.json` | Gateway WebSocket 첫 메시지 (기기 10개) |
| `gateway-state-changed.json` | 기기 변경 메시지 (room1 조명 모드 normal → meeting) |
| `gateway-devices.json` | `GET /devices` |
| `collector-snapshot.json` | Collector WebSocket 첫 메시지 (최근 기록 몇 개로 줄임) |
| `collector-event.json` | Collector 실시간 기록 한 줄 |
| `flows.json` | `GET /flows?limit=4` |
| `flow-detail.json` | `GET /flows/demo-meeting` (desktop → Home → room1 위임 한 건) |

## 7. 확인 체크리스트

- [ ] `scripts/scenario.sh`를 돌리면 거실 TV 음소거, 침실 3 조명 모드, 절전 결과가 화면에 바로 반영된다
- [ ] 통신 로그에 요청과 결과(수락/거절, 사유)가 시간순으로 나온다
- [ ] 요청 카드에서 집 전체 절전이 "일부만 수락(room2 안전 정책)"으로 보인다
- [ ] services를 재시작해도(`cd services && docker compose restart`) 화면이 다시 붙고 상태가 맞다
- [ ] Home Assistant를 멈추면 "기기 연결 끊김"이 표시된다
- [ ] 토큰이 커밋되지 않았다 (`git status`에 `.env.local`이 없다)
