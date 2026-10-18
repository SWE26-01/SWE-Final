# 실행 가이드

이 문서는 Ambient-A2A 스마트홈을 처음 받은 사람이 설치부터 시나리오 검증, 데모까지 따라 할 수 있도록 정리한 것이다. 시스템은 OpenClaw 에이전트 5개, Home Assistant, Device Gateway·Event Collector(`services/`), 시뮬레이터 화면(`frontend/`)으로 이루어져 있다. 구조와 설계는 [README](../README.md), [plan.md](../plan.md), [HANDOFF.md](HANDOFF.md)를 본다.

## 1. 필요한 것

| 항목 | 비고 |
|---|---|
| macOS 또는 Linux | Windows는 WSL을 쓴다 |
| [nvm](https://github.com/nvm-sh/nvm) | `setup.sh`가 Node 24를 설치한다. OpenClaw는 Node 24.16 이상이 필요하다 |
| Docker | Home Assistant, Gateway, Collector 컨테이너 실행용 |
| Python 3.11+ | a2a-sdk 검증 클라이언트 실행용 |
| `jq`, `rsync`, `openssl` | macOS에는 기본으로 있다 |
| OpenRouter API 키 | 자연어 흐름에만 필요하다. 없어도 A2A 검증은 동작한다 |

## 2. 최초 설정 (1회)

```bash
scripts/setup.sh
```

다시 실행해도 안전하다. 끝난 단계는 건너뛴다. 하는 일은 다음과 같다.
1. Node 24와 OpenClaw `2026.10.4` 설치
2. 플러그인 의존성 설치, Python 가상환경(`.venv`) 생성
3. `.env` 생성. 에이전트별 토큰과 게이트웨이 토큰을 랜덤 값으로 채운다
4. Home Assistant 컨테이너 기동. 초기 설정(온보딩)을 자동으로 마치고, 장기 접근 토큰을 발급해 `.env`의 `HA_TOKEN`에 저장한다

그다음 `.env`를 열어 **`OPENROUTER_API_KEY`만 직접 채운다.**
- 모델을 바꾸려면 `AMBIENT_MODEL=openrouter/<provider>/<model>`을 수정한다.
- **tool calling을 지원하는 모델이어야 한다.** 지원하지 않으면 에이전트가 말로만 대답하고 기기에는 아무 일도 일어나지 않는다. `openrouter/auto`는 피한다.

`.env`는 gitignore돼 있다. 커밋하지 않는다.

## 3. 실행

화면은 터미널 3개와 브라우저 하나로 구성하는 것을 권장한다.

| 위치 | 명령 / 주소 | 용도 |
|---|---|---|
| 터미널 1 | `scripts/run_all.sh` | HA, Gateway·Collector, 에이전트 5개 기동. 5줄 모두 `up`이 뜨고 Gateway·Collector 주소가 출력되면 준비 완료. 이후엔 그대로 둔다 |
| 터미널 2 | `scripts/logs.sh` | 에이전트 간 메시지를 실시간으로 본다 |
| 터미널 3 | 시나리오 명령 | 아래 4장 |
| 브라우저 | http://127.0.0.1:8123/ambient-home | HA 기기 상태 대시보드 |
| 브라우저 (선택) | http://localhost:5173 | 시뮬레이터 화면. `cp frontend/.env.example frontend/.env.local`(토큰 입력) 후 `cd frontend && npm ci && npm run dev`. 오른쪽 위 LIVE로 실제 데이터를 본다 |

HA 로그인 계정은 `admin`이고, 비밀번호는 `.env`의 `HA_ADMIN_PASSWORD`다.

`run_all.sh`는 Gateway(:8100)와 Collector(:8200)를 함께 띄운다. 에이전트는 HA를 Gateway를 거쳐 쓰고, 이벤트를 Collector로도 보낸다. Gateway·Collector 없이 HA를 직접 쓰려면 `AMBIENT_SERVICES=off scripts/run_all.sh`로 실행한다.

**로그 읽는 법** (`logs.sh`의 한 줄):
```
13:00:23  orchestrator  in  desktop  device.control  ✔  OK  TURN_ON input_boolean.living_tv_muted  TURN_ON ...
시각       기록한 에이전트  방향  상대     메시지 종류       결과   reason_code  동작                        메시지
```
방향 값의 의미:
- `out` / `in`: 보냄 / 받음
- `out-result`: 보낸 요청의 응답
- `exec`: 기기를 실제로 실행함
- `rule`: 자동화 규칙이 발동함

**종료**: 터미널 1에서 Ctrl-C를 누르면 에이전트가 내려간다. HA와 Gateway·Collector 컨테이너는 계속 돈다. 컨테이너까지 끄려면 다음을 실행한다.
```bash
docker compose -f services/docker-compose.yml down
docker compose -f homeassistant/docker-compose.yml down
```

## 4. 시나리오 검증

### 4.1 결정적 검증 — LLM 없이, 무료, 몇 초

```bash
scripts/scenario.sh
```

표준 Python `a2a-sdk` 클라이언트로 각 에이전트에 직접 메시지를 보낸다. 단계마다 `== 번호. 설명` 제목과 응답(`TASK_STATE_*` + 결과 JSON)이 출력된다.

| 단계 | 내용 | 기대 결과 |
|---|---|---|
| 8 | 5개 Agent Card 조회 | 모두 `ambient=yes` |
| A | desktop → home: 내 방 조명을 회의 모드로 | `OK`, `delegated_to: room1`. 대시보드 조명 모드가 `meeting` |
| A | desktop → home: 거실 TV 음소거 | `OK`. 대시보드 TV 음소거 ON |
| 1-1 | desktop → home: room2 에어컨 끄기 | `UNAUTHORIZED`. 로그에 room2로 가는 요청이 **없어야** 정상 |
| B | home이 desktop의 `pc_state` 조회 | `FIELD_NOT_ALLOWED`. 허용된 `meeting_app_active`만 반환 |
| 3 | 잘못된 토큰 | `UNAUTHORIZED` |
| 4 | 오래된 sequence, 만료된 상태 데이터 | `STALE` |
| 5 | room1이 거실 TV 제어 | `NOT_OWNER` |
| 6 | room2 수면 중 집 전체 절전 | `PARTIAL`. room1 에어컨 OFF, room2 에어컨 ON 유지(`SAFETY_POLICY`) |

Gateway·Collector 연동은 따로 확인한다(세 항목이 모두 `ok`이고 마지막 줄이 `all checks passed`여야 정상).
```bash
python services/scripts/verify_integration.py --env-file .env
```
1. Agent Card의 기기 주인이 `services/config/devices.yaml`과 같은지
2. Gateway가 남의 기기에 대한 명령을 막는지
3. Collector에 다섯 에이전트의 이벤트가 모두 있는지

요청 하나가 에이전트들을 거친 흐름은 Collector `GET /flows`로 볼 수 있다([integration.md](integration.md)).

### 4.2 자연어 흐름 — OpenRouter 과금 발생

```bash
scripts/oc.sh desktop agent --agent main --message "나 회의 시작할게"
scripts/oc.sh orchestrator agent --agent main --message "지금 집 전체 절전해도 될까?"
scripts/oc.sh smartphone agent --agent main --message "나 나간다"
```

| 문장 | 일어나는 일 |
|---|---|
| 나 회의 시작할게 | desktop이 상태를 공유하고 home에 요청한다. home은 권한을 확인한 뒤 TV는 직접 음소거하고, 조명은 room1에 위임한다 |
| 집 전체 절전해도 될까? | home이 desktop과 폰에 `context.query`로 상태를 조회한 뒤 판단한다(예: 회의 중이면 보류) |
| 나 나간다 | `presence=AWAY` → room1 절전, home 전체 절전 → room2는 일부 거절 |

앞의 두 문장은 `scripts/scenario.sh --llm`으로 한 번에 실행할 수도 있다.

**빠른 경로**: `oc.sh ... agent`는 매번 CLI를 새로 띄우므로 2~3.5초가 더 걸린다. 데모에서는 이미 떠 있는 OpenClaw 게이트웨이에 HTTP로 바로 요청하는 `say.sh`를 쓰는 게 좋다. 응답 시간 측정 결과는 [performance.md](performance.md)에 있다.
```bash
scripts/say.sh desktop "나 회의 시작할게"
SAY_SESSION=scene2 scripts/say.sh smartphone "나 나간다"   # 장면마다 새 세션을 써서 프롬프트가 쌓이지 않게
```

### 4.3 Home 중단 시 방의 독립 동작

```bash
scripts/scenario.sh --kill-home
```

orchestrator를 끈 뒤 desktop 상태를 room1에 보낸다. room1이 혼자서 조명 모드를 `meeting`으로 바꾸면 정상이다. 끝나면 orchestrator를 다시 띄운다.
```bash
scripts/oc.sh orchestrator gateway
```

### 4.4 다시 실행할 때

시나리오는 기기 상태를 바꿔 둔다. 이미 목표 상태면 변화가 보이지 않으므로, 대시보드에서 토글을 원래대로 돌려놓고 실행한다.

## 5. 데모 추천 순서

1. 대시보드와 `logs.sh`를 나란히 띄운다.
2. **"나 회의 시작할게"**: 외부 기기 정보 활용과 위임 체인(desktop → home → room1)을 보여 준다.
3. 대시보드에서 **보호 방 수면 모드**를 켠다.
4. **"나 나간다"**: room2가 에어컨 끄기를 `SAFETY_POLICY`로 거절하는 장면을 보여 준다(정책 기반 거절).
5. **`scripts/scenario.sh --kill-home`**: Home 없이도 방이 동작하는 장면을 보여 준다(방 자율성).

## 6. 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| `run_all.sh`에서 `NOT UP` | `logs/<agent>.log` 마지막 줄을 확인한다 |
| 로그에 `EADDRINUSE` / `Port ... already in use` | 이전에 띄운 게이트웨이가 남아 있다. `pkill -f openclaw-gateway` 후 다시 실행한다 |
| `Include file failed security checks` 또는 `unsafe plugin manifest path` | OpenClaw가 한글 경로를 거부한 것이다. `scripts/oc.sh`를 거치지 않고 `openclaw`를 직접 실행하면 생긴다. 항상 `oc.sh`나 `run_all.sh`로 실행한다(`~/.ambient-a2a`에 ASCII 미러를 만들어 실행한다) |
| 상태 업데이트가 계속 `STALE` | 받는 쪽이 더 큰 sequence를 이미 받은 상태다. 해당 에이전트를 재시작하면 초기화된다 |
| 자연어 요청에 말로만 답하고 기기 변화가 없음 | 모델이 tool calling을 지원하지 않는다. `AMBIENT_MODEL`을 바꾼다 |
| 에이전트가 응답하지 않음 / OpenRouter 타임아웃 | `OPENROUTER_API_KEY`와 네트워크를 확인한다. 로그에 `openrouter.ai` fetch timeout이 보이면 네트워크 문제다 |
| `setup.sh`: `HA is already onboarded` | HA 초기 설정이 이미 끝난 경우다. HA UI → 프로필 → 보안 → 장기 액세스 토큰을 발급해 `.env`의 `HA_TOKEN`에 넣는다 |
| 기기 제어가 전부 `EXECUTION_FAILED ... HTTP 401`, Gateway 로그에 `Home Assistant rejected the token (HA_TOKEN)` | `.env`의 `HA_TOKEN`이 지금 떠 있는 HA의 토큰이 아니다. 클론이 두 개(예: 예전 A2A-agents와 SWE-Final)면 HA 컨테이너 이름(`ambient-ha`)이 같아서, 나중에 `setup.sh`·`run_all.sh`를 돌린 쪽의 `homeassistant/config`로 HA가 다시 만들어진다. 이 레포 `.env`의 `HA_TOKEN`·`HA_ADMIN_PASSWORD`를 비우고 `scripts/setup.sh`를 다시 실행한 뒤, `docker compose -f services/docker-compose.yml up -d --force-recreate`로 Gateway가 새 토큰을 읽게 한다 |
| `verify_integration.py`에서 어떤 에이전트의 이벤트가 0개 | 그 에이전트가 아직 아무 요청도 처리하지 않았거나 기기 제어에 실패했다. `scripts/scenario.sh`를 한 번 돌린 뒤 다시 확인한다 |
| HA를 완전히 초기화하고 싶음 | `docker compose -f homeassistant/docker-compose.yml down`. `homeassistant/config`에서 `configuration.yaml`과 `dashboards/`를 뺀 나머지를 지우고, `.env`의 `HA_TOKEN`을 비운 뒤 `scripts/setup.sh`를 다시 실행한다 |
| 에이전트 상태를 초기화하고 싶음 | 게이트웨이를 종료하고 `rm -rf ~/.ambient-a2a/state` |

## 7. 개별 실행 (참고)

```bash
scripts/oc.sh <agent> gateway                          # 에이전트 하나만 기동 (desktop|smartphone|orchestrator|room1|room2)
scripts/oc.sh <agent> agent --agent main --message ".." # 자연어 한 턴
.venv/bin/python scripts/a2a_probe.py cards             # Agent Card 조회
set -a; . ./.env; set +a                                 # probe 전에 토큰 로드
.venv/bin/python scripts/a2a_probe.py send <대상> <보내는쪽> '<DataPart JSON>'
scripts/say.sh <agent> "..."                             # 자연어 한 턴 (빠른 경로)
cd agents/ambient-a2a-plugin && pnpm test               # 플러그인 단위 테스트
cd services && pip install -e ".[dev]" && ruff check . && pytest   # services 검사 (CI와 같음)
cd frontend && npm ci && npm run build                   # frontend 빌드 (CI와 같음)
```
