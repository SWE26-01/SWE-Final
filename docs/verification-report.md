# 검증 결과 보고서 (W12-3)

기획서(`plan.md`) 8.3의 검증 항목 8개를 실제로 돌아가는 시스템에서 확인한 결과다.

- 일시: 2026-10-18
- 대상: SWE-Final `main` `ccdb7b1`
- 원본 출력: [docs/verification/2026-10-18/](verification/2026-10-18/)

## 요약

**8개 항목 중 7개 통과, 1개 부분 통과**(신규 Agent 연결)다. 추가로 다음 네 가지를 확인했다.
- 기기 소유권을 에이전트 밖에서 다시 막는 Device Gateway
- 요청 단위 기록 추적
- 사람 말로 시작한 흐름(LLM)
- 개인정보가 밖으로 나가지 않는지

| # | 검증 항목 | 결과 | 핵심 근거 |
|---|---|---|---|
| 1 | 외부 Agent의 상태 데이터가 올바르게 전달되는가? | 통과 | Desktop이 공유한 회의 상태를 room1·Home이 받아 조명 회의 모드, TV 음소거 |
| 2 | 허용되지 않은 사용자 상태 조회가 차단되는가? | 통과 | Home의 `pc_state` 조회 → `FIELD_NOT_ALLOWED`. 모르는 토큰 → `UNAUTHORIZED` |
| 3 | 오래되거나 만료된 상태 데이터가 무시되는가? | 통과 | 순번이 거꾸로 온 데이터, 만료된 데이터 모두 `STALE` |
| 4 | 각 Room Agent가 자신의 기기만 직접 제어하는가? | 통과 | room1 → 거실 TV `NOT_OWNER`. Home은 방 기기를 주인에게 위임. Gateway가 남의 기기 명령 10건 차단 |
| 5 | 안전 정책에 위배되는 제어 요청이 거절되는가? | 통과 | 수면 중인 room2 에어컨 끄기 → `SAFETY_POLICY`, 에어컨 켜진 상태 유지 |
| 6 | Home Agent 중단 시 Room Agent가 독립적으로 동작하는가? | 통과 | Home 종료 후에도 room1이 Desktop 회의 신호를 받아 조명 회의 모드 |
| 7 | 여러 Room Agent가 집 전체 작업을 협력하여 처리할 수 있는가? | 통과 | 집 전체 절전: 거실·room1 실행, room2 일부 거절 → Home이 `PARTIAL`로 취합 |
| 8 | 새로운 Room Agent를 기존 구조에 연결할 수 있는가? | 부분 통과 | Home이 방의 Agent Card에서 소유 기기를 스스로 알아냄. 새 에이전트 주소·토큰은 설정에 추가해야 하고, 새 방을 실제로 붙여 보는 시험은 하지 않음 |

## 1. 검증 환경

| 항목 | 값 |
|---|---|
| 에이전트 | OpenClaw 2026.10.4, 5개 프로세스: desktop, smartphone, orchestrator(Home), room1(My Room), room2(수면 정책 방) |
| LLM | OpenRouter `anthropic/claude-sonnet-5-5`. 에이전트마다 별도 컨텍스트 |
| 기기 | Home Assistant 2026.10.2(Docker), 가상 엔티티 10개 (실제 기기 없음) |
| Device Gateway·Event Collector | `services/`, Docker. `scripts/run_all.sh`가 함께 띄우고, 에이전트는 Gateway를 거쳐 HA를 쓰고 Collector에 기록을 보냄 |
| 실행 환경 | macOS 26.5.1, Node 24.22.0, Python 3.13.5, a2a-sdk 1.2.2(표준 클라이언트), Docker 28.0.1. PC 한 대 |

## 2. 검증 방법

1. **자동 테스트 (CI)**
   - `services/` 71개: 가짜 HA를 사용. 소유권 검사, 차단 규칙, 기록 형식, 요청 흐름
   - 에이전트 플러그인 19개: 정책·소유권·만료 판단, 위임과 절전 흐름, Gateway·Collector 설정, 요청 ID 전달
2. **결정적 시나리오** (`scripts/scenario.sh`)
   - 표준 a2a-sdk 클라이언트로 에이전트에 A2A 메시지를 직접 보낸다.
   - LLM을 거치지 않아 매번 같은 결과가 나온다. 판정은 이 결과를 기준으로 했다.
3. **사람 말로 시작한 흐름 (LLM)**
   - Desktop에 "나 회의 시작할게"를 보냈다.
   - Home에 "지금 집 전체 절전해도 될까? 데스크탑과 폰 상태를 먼저 확인하고 판단해줘."를 보냈다.
4. **Home 중단**: orchestrator 프로세스를 끈 뒤 room1에 Desktop의 회의 신호를 보냈다.
5. **연동 확인** (`services/scripts/verify_integration.py`)
   - 에이전트 카드의 소유 기기와 `services/config/devices.yaml`이 같은지
   - Gateway가 남의 기기 명령을 막는지
   - 모든 에이전트의 기록이 Collector에 모였는지
6. **근거 자료**: 각 단계의 응답(`accepted`, `reason_code`), Home Assistant 기기 상태, Collector 기록과 요청별 흐름(`GET /flows`)

## 3. 항목별 결과

### 3.1 외부 Agent의 상태 데이터 전달 — 통과
- **방법**: Desktop에 "나 회의 시작할게". 결정적 시나리오 4단계에서도 새 상태 하나를 보냈다.
- **결과**
  - Desktop이 `meeting_app_active: true`, `pc_state: ACTIVE`를 구독자에게 보냈다.
  - room1과 Home 모두 `OK`로 받았다. Collector 기록 42~47번.
  - 받은 상태로 각자의 자동화 규칙이 실행됐다.
    - Home: 거실 TV 음소거 (48~49번)
    - room1: 조명 회의 모드 (50~51번)
  - Home Assistant 상태: `living_tv_muted` off → on, `room1_light_mode` normal → meeting
- **근거**: `events-llm-desktop.txt`, `llm-desktop.txt`, `scenario.txt` 4단계

### 3.2 허용되지 않은 조회 차단 — 통과
- **Home이 Desktop의 `meeting_app_active`, `pc_state`를 함께 조회**
  - `granted: [meeting_app_active]`, `denied: [pc_state]`, `FIELD_NOT_ALLOWED`
  - Home에는 `pc_state` 공개가 허용돼 있지 않다.
- **모르는 토큰으로 조회** → `UNAUTHORIZED` (`unknown bearer token`)
- **Desktop이 허락받지 않은 room2 에어컨 끄기를 Home에 요청** → Home이 room2에 넘기기 전에 `UNAUTHORIZED`로 거절. room2 에어컨은 그대로였다.
- **근거**: `scenario.txt` B, 3, 1-1단계

### 3.3 오래되거나 만료된 데이터 무시 — 통과
- 새 순번 데이터 → `OK`
- 순번이 거꾸로 온 데이터 → `STALE`
- 유효기간이 지난 데이터 → `STALE`
- **근거**: `scenario.txt` 4단계

### 3.4 자기 기기만 직접 제어 — 통과
- room1에게 거실 TV를 끄라고 요청 → `NOT_OWNER`
- Desktop이 Home에 room1 조명 회의 모드를 요청 → Home이 직접 하지 않고 room1에 위임했다(`delegated_to: room1`). room1이 실행해서 `OK`.
- **에이전트 밖에서 한 번 더**: Device Gateway가 각 에이전트의 남의 기기 명령과 `homeassistant.restart` 요청 10건을 모두 HA에 닿기 전에 403으로 막았다. 같은 실행에서 정상 명령 13건은 통과시켰다.
- **근거**: `scenario.txt` A·5단계, `verify.txt` 2번

### 3.5 안전 정책 거절 — 통과
- **방법**: room2를 수면 모드로 둔 상태에서 집 전체 절전
- **결과**
  - room2의 조명은 꺼졌다.
  - 에어컨 끄기는 `SAFETY_POLICY`("Temperature regulation must remain enabled while sleeping.")로 거절됐다.
  - 끝난 뒤 상태: `room2_ac=on`
- **근거**: `scenario.txt` 6단계

### 3.6 Home 중단 시 독립 동작 — 통과
- **방법**: orchestrator 프로세스를 종료(카드 요청에 응답 없음 확인)한 뒤, room1 조명을 normal로 되돌렸다. 그리고 Desktop의 회의 신호(`context.update`, `scripts/scenario.sh --kill-home`처럼 Desktop 신원으로 표준 클라이언트가 보냄)를 room1에 보냈다.
- **결과**: room1이 `OK`로 받고 규칙대로 조명을 `meeting`으로 바꿨다. Home 없이도 방이 외부 에이전트의 상태를 받아 스스로 동작했다.
- **근거**: `kill-home.txt`

### 3.7 집 전체 협업 — 통과
- **방법**: smartphone이 Home에 집 전체 절전(`ENERGY_SAVING`)을 요청
- **결과**
  - Home은 자기 거실 기기를 끄고 방마다 요청을 나눴다(`scn-6/room1`, `scn-6/room2`).
  - room1: 전부 `OK`. room2: 에어컨만 `SAFETY_POLICY`.
  - Home이 방별 결과를 모아 `PARTIAL`로 답했다.
  - Collector `/flows`에서 이 요청은 에이전트 3개, 기록 13개로 한 흐름에 묶였다.
- **근거**: `scenario.txt` 6단계, `flows-after-scenario.json`의 `scn-6`

### 3.8 신규 Agent 연결 — 부분 통과
- **확인한 것**
  - Home은 방 소유 기기를 설정에 적어 두지 않는다. 각 방의 Agent Card(`owned_devices`)를 읽어 스스로 알아내고, 그걸로 위임했다(3.4).
  - 표준 a2a-sdk 클라이언트가 다섯 에이전트의 카드와 Ambient-A2A 확장을 모두 인식했다.
  - 카드의 소유 기기가 `services/config/devices.yaml`과 같았다(`verify.txt` 1번).
- **한계**
  - 새 에이전트를 붙이려면 주소와 토큰을 `agents/shared.json5`(`peers`, `tokens`)와 `services/config/agents.yaml`에 추가해야 한다.
  - 새 방을 실제로 추가해 보는 시험은 이번에 하지 않았다.
- **근거**: `scenario.txt` 8단계, `verify.txt`

## 4. 추가 검증

### 4.1 사람 말로 시작한 흐름 (LLM)
- **Desktop "나 회의 시작할게"**: LLM이 두 가지를 했다(3.1).
  - 상태 공유
  - Home에 TV 음소거와 room1 조명 회의 모드 요청. Home은 TV를 직접 처리했고, 조명은 room1에 위임했다. 두 요청 모두 `OK`.
- **Home "집 전체 절전해도 될까?"**: LLM이 Desktop과 smartphone에 상태를 조회했다(기록 63~68번).
  - "회의 중(`meeting_app_active: true`)이고, 재실 여부(`presence`)를 알 수 없어서 절전을 보류한다"고 판단했다. 명령은 보내지 않았다.
  - 조회한 항목은 각자 Home에 허용된 것뿐이었다(`meeting_app_active`, `presence`).
- **해석**: 지금 구조에서 LLM은 사람 말을 해석해 도구를 부르고, 공유받은 상태를 근거로 판단한다. 수락·거절·안전 판단은 에이전트 코드와 Gateway가 한다. LLM 응답은 실행마다 달라질 수 있어서 항목 판정에는 쓰지 않았다.

### 4.2 기록과 요청 추적
- 이번 실행의 기록은 71건이다(desktop 13, smartphone 3, orchestrator 29, room1 23, room2 3). 모두 Collector에 저장됐고 거부된 기록은 없었다.
- 요청 하나에 붙은 ID가 위임·실행·절전·규칙까지 이어져서, Collector가 요청별로 묶었다.

  | 요청 | 흐름 | 결과 |
  |---|---|---|
  | `scn-A1` | desktop → orchestrator → room1, 기록 5개 | `OK` |
  | `scn-A3` | desktop → orchestrator | `UNAUTHORIZED` |
  | `scn-6` | 에이전트 3개, 기록 13개 | `PARTIAL` |

### 4.3 개인정보
- 에이전트는 공개하기로 한 항목만, 요청자별 허용 범위 안에서 보낸다(설정과 자동 테스트로 확인).
  - Desktop: room1에는 `meeting_app_active`·`pc_state`, Home에는 `meeting_app_active`만
- Collector는 정해진 항목만 저장하고 맥락 값(일정 제목 등)은 남기지 않는다. 모르는 항목은 버린다(자동 테스트).
- Gateway는 기기 목록에 없는 HA 정보를 보여 주지 않는다. 사람 엔티티(`person.*`) 조회 → 404.

## 5. 한계와 남은 과제

| 한계 | 내용 |
|---|---|
| 사용자 승인(Human Approval, P1) | 아직 구현되지 않아 검증하지 않았다 |
| 방 LLM의 판단 범위 | 다른 에이전트가 보낸 요청은 방의 LLM이 아니라 코드 규칙이 판단한다. LLM이 요청을 판단하는 구조의 안전성은 이번 범위 밖이다 |
| 실제 기기·환경 | Home Assistant 가상 기기만 쓰고, 모든 구성 요소가 PC 한 대에서 돈다. 에이전트들이 같은 `.env`를 읽어서, 한 에이전트가 뚫리면 다른 토큰도 노출될 수 있다 |
| 외부 기기 신호 | Desktop의 회의 상태는 사람이 말로 알려 준다. 실제 PC 상태를 감지하지 않는다 |
| 신규 Agent | 새 방을 실제로 붙여 보는 시험이 남았다(3.8) |
| 화면 | 시뮬레이터 화면(`frontend/`)은 아직 실제 데이터와 연결되지 않았다 |

## 6. 재현 방법

```bash
scripts/setup.sh                       # 처음 한 번 (.env, Home Assistant)
scripts/run_all.sh                     # HA + Gateway·Collector + 에이전트 5개
scripts/scenario.sh                    # 결정적 시나리오 (1~5, 7, 8)
scripts/oc.sh desktop agent --agent main --message "나 회의 시작할게"
scripts/oc.sh orchestrator agent --agent main --message "지금 집 전체 절전해도 될까? 데스크탑과 폰 상태를 먼저 확인하고 판단해줘."
scripts/scenario.sh --kill-home        # Home 중단 시 독립 동작 (6)
python services/scripts/verify_integration.py --env-file .env
curl -H "Authorization: Bearer $DASHBOARD_TOKEN" http://127.0.0.1:8200/flows
```
