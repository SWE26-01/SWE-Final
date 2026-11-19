# 실행 가이드

설치부터 데모까지의 순서. 전부 Docker Compose 하나로 띄운다.

## 1. 필요한 것

- Docker (Docker Desktop 등, `docker compose` v2)
- `curl`, `jq`, `openssl`, `perl` (macOS 기본 + `brew install jq`)
- OpenRouter API 키 (에이전트의 자연어 응답과 Studio의 LLM. 없으면 A2A 검증과 `STUDIO_LLM=rules`만 된다)
- 시나리오 검증(`scripts/scenario.sh`)을 돌리려면 Python 3.11+

## 2. 최초 설정 (1회)

```bash
scripts/setup.sh            # .env를 만들고 토큰을 랜덤 값으로 채운다. 다시 실행해도 안전(빠진 키만 추가)
```
그다음 `.env`에 **`OPENROUTER_API_KEY`** 만 직접 넣는다.
- 에이전트 모델은 `AMBIENT_MODEL`(기본 `openrouter/anthropic/claude-haiku-5.5`). tool calling을 지원하는 모델이어야 하고 `openrouter/auto`는 피한다.
- Studio 모델은 `STUDIO_MODEL`. 키 없이 돌리려면 `STUDIO_LLM=rules`.

시나리오 검증까지 하려면 `scripts/setup.sh --local`: a2a-sdk probe용 `.venv`와, 에이전트를 호스트에서 직접 돌릴 때 필요한 Node 24·OpenClaw·플러그인 의존성을 설치한다.

## 3. 실행

```bash
scripts/run_all.sh          # docker compose up -d --build 후 전부 뜰 때까지 기다리고 주소를 출력
```

| 이름 | 주소 | 내용 |
|---|---|---|
| hub-web | http://127.0.0.1:3000 | Agent Hub 화면 |
| hub | http://127.0.0.1:8400/docs | Agent Hub API |
| studio | http://127.0.0.1:8500/docs | Agent Studio API |
| gateway | http://127.0.0.1:8100/devices | 가상 집의 기기 상태 (`Authorization: Bearer $DASHBOARD_TOKEN`) |
| collector | http://127.0.0.1:8200/flows | 에이전트 통신 기록 (같은 토큰) |
| agents | 127.0.0.1:18800 / 18920 / 19040 / 19160 / 19280 | desktop / smartphone / orchestrator(Root) / room1 / room2 |

모든 포트는 127.0.0.1에만 열린다. 이벤트 로그는 `scripts/logs.sh`(다른 터미널), 에이전트 출력은 `docker compose logs -f agents`, 에이전트별 로그는 `logs/<id>.log`.

**종료**: `docker compose down` (데이터까지 지우려면 `docker compose down -v`).

## 4. 시나리오 검증

### 4.1 결정적 검증 — LLM 없이, 무료, 몇 초

```bash
scripts/scenario.sh
```

표준 Python `a2a-sdk` 클라이언트로 각 에이전트에 직접 메시지를 보낸다. 단계마다 `== 번호. 설명` 제목과 응답(`TASK_STATE_*` + 결과 JSON)이 출력된다.

| 단계 | 내용 | 기대 결과 |
|---|---|---|
| 8 | 5개 Agent Card 조회 | 모두 `ambient=yes` |
| A | desktop → home: 내 방 조명을 회의 모드로 | `OK`, `delegated_to: room1`. 조명 모드가 `meeting` |
| A | desktop → home: 거실 TV 음소거 | `OK` |
| 1-1 | desktop → home: room2 에어컨 끄기 | `UNAUTHORIZED`. 로그에 room2로 가는 요청이 **없어야** 정상 |
| B | home이 desktop의 `pc_state` 조회 | `FIELD_NOT_ALLOWED`. 허용된 `meeting_app_active`만 반환 |
| 3 | 잘못된 토큰 | `UNAUTHORIZED` |
| 4 | 오래된 sequence, 만료된 상태 데이터 | `STALE` |
| 5 | room1이 거실 TV 제어 | `NOT_OWNER` |
| 6 | room2 수면 중 집 전체 절전 | `PARTIAL`. room1 에어컨 OFF, room2 에어컨 ON 유지(`SAFETY_POLICY`) |

6단계 준비(수면 모드·에어컨 켜기)는 스크립트가 각 기기의 주인 에이전트 토큰으로 Gateway에 직접 요청한다.

Gateway·Collector 연동 확인(마지막 줄이 `all checks passed`여야 정상):
```bash
python services/scripts/verify_integration.py --env-file .env    # services 패키지가 설치된 Python으로
```
1. Agent Card의 기기 주인이 `services/config/devices.yaml`과 같은지
2. Gateway가 남의 기기에 대한 명령을 막는지
3. Collector에 다섯 에이전트의 이벤트가 모두 있는지

Hub·Studio 확인: `scripts/test_hub_studio.sh` (26단계).

### 4.2 자연어 흐름 — OpenRouter 과금 발생

```bash
scripts/say.sh desktop "나 회의 시작할게"
scripts/say.sh orchestrator "지금 집 전체 절전해도 될까?"
SAY_SESSION=scene2 scripts/say.sh smartphone "나 나간다"   # 장면마다 새 세션을 써서 프롬프트가 쌓이지 않게
```

| 문장 | 일어나는 일 |
|---|---|
| 나 회의 시작할게 | desktop이 상태를 공유하고 home에 요청한다. home은 권한을 확인한 뒤 TV는 직접 음소거하고, 조명은 room1에 위임한다 |
| 집 전체 절전해도 될까? | home이 desktop과 폰에 `context.query`로 상태를 조회한 뒤 판단한다(예: 회의 중이면 보류) |
| 나 나간다 | `presence=AWAY` → room1 절전, home 전체 절전 → room2는 일부 거절 |

`say.sh`는 떠 있는 OpenClaw 게이트웨이에 HTTP로 바로 보낸다. 응답 시간 측정은 [performance.md](performance.md).

### 4.3 Home 중단 시 방의 독립 동작

```bash
scripts/scenario.sh --kill-home
```

orchestrator만 끈 뒤 desktop 상태를 room1에 보낸다. room1이 혼자서 조명 모드를 `meeting`으로 바꾸면 정상이다. 끝나면 `docker compose restart agents`.

### 4.4 다시 실행할 때

시나리오는 기기 상태를 바꿔 둔다. 가상 집은 Gateway 메모리에 있으므로 `docker compose restart gateway`로 처음 상태(꺼짐, 조명 모드 `normal`)로 돌린다.

## 5. 데모 추천 순서

1. Hub 화면(http://127.0.0.1:3000)과 `scripts/logs.sh`를 나란히 띄운다.
2. **"나 회의 시작할게"**: 외부 기기 정보 활용과 위임 체인(desktop → home → room1)을 보여 준다.
3. `scripts/say.sh room2 "수면 모드 켜 줘"`: 보호 방의 주인 에이전트가 자기 기기를 켠다.
4. **"나 나간다"**: room2가 에어컨 끄기를 `SAFETY_POLICY`로 거절하는 장면을 보여 준다(정책 기반 거절).
5. **`scripts/scenario.sh --kill-home`**: Root 없이도 방이 동작하는 장면을 보여 준다(방 자율성).
6. Studio로 자연어 에이전트를 만들고 Hub에 등록·연결한다(`scripts/test_hub_studio.sh`가 같은 흐름을 HTTP로 보여 준다).

## 6. 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| `run_all.sh`에서 `NOT UP` | 출력된 `docker compose logs <이름>`을 확인한다. 에이전트는 `logs/<agent>.log` |
| `Bind for 127.0.0.1:8100 failed: port is already allocated` | 예전 방식으로 띄운 컨테이너나 호스트 에이전트가 남아 있다. `docker ps`로 찾아 끄거나 `pkill -f openclaw-gateway` |
| 상태 업데이트가 계속 `STALE` | 받는 쪽이 더 큰 sequence를 이미 받은 상태다. `docker compose restart agents` |
| 자연어 요청에 말로만 답하고 기기 변화가 없음 | 모델이 tool calling을 지원하지 않는다. `AMBIENT_MODEL`을 바꾼다 |
| 에이전트가 응답하지 않음 / OpenRouter 타임아웃 | `OPENROUTER_API_KEY`와 네트워크를 확인한다 |
| Studio가 `failed` | LLM 호출 실패. 키를 확인하거나 `.env`에 `STUDIO_LLM=rules` 후 `docker compose up -d studio` |
| `verify_integration.py`에서 어떤 에이전트의 이벤트가 0개 | 그 에이전트가 아직 아무 요청도 처리하지 않았다. `scripts/scenario.sh`를 한 번 돌린 뒤 다시 확인한다 |
| 에이전트 상태를 초기화하고 싶음 | `docker compose down` 후 `docker volume rm swe-final_agents-state` |

## 7. 개별 실행 (참고)

```bash
docker compose up -d --build <이름>                     # 하나만 다시 빌드·기동 (gateway, studio, agents …)
docker compose exec agents scripts/oc.sh <id> gateway   # Studio가 만든 에이전트를 agents 컨테이너에서 실행
scripts/oc.sh <agent> gateway                           # 호스트에서 직접 실행 (setup.sh --local 필요, compose의 agents와 포트가 겹침)
set -a; . ./.env; set +a                                # probe 전에 토큰 로드
.venv/bin/python scripts/a2a_probe.py cards             # Agent Card 조회
.venv/bin/python scripts/a2a_probe.py send <대상> <보내는쪽> '<DataPart JSON>'
cd agents/ambient-a2a-plugin && pnpm test               # 플러그인 단위 테스트
cd services && pip install -e ".[dev]" && ruff check . && pytest   # services 검사 (CI와 같음)
```
