# services — Device Gateway · Event Collector · Runner

에이전트(`../agents`) 옆에서 세 가지를 맡는 Python 서비스.

- **Device Gateway** (`gateway/`): 에이전트는 Home Assistant 대신 Gateway를 부른다. Gateway는 요청한 에이전트가 그 기기의
  주인인지 다시 확인하고, 통과한 명령만 HA에 넘긴다. 대시보드에는 기기 상태를 WebSocket으로 보낸다.
- **Event Collector** (`collector/`): 모든 에이전트의 A2A 통신·실행·자동화 기록을 한곳에 모으고 대시보드에 실시간으로 보낸다.
- **Runner** (`runner/`): Live Simulation이 시나리오(`config/scenarios.yaml`)나 자유 입력을 고르면, 사용자가 채팅하듯 해당
  에이전트의 LLM에 말을 건다(OpenClaw chat 엔드포인트). 기기는 직접 건드리지 않고, 판단은 에이전트가 한다.

에이전트와 연결하는 방법: [../docs/integration.md](../docs/integration.md)

## 구조

| 폴더 | 내용 |
| --- | --- |
| `gateway/` | HA 프록시(주인 검사), HA 상태 스트림, 대시보드 WebSocket |
| `collector/` | 이벤트 저장(SQLite), 조회, 대시보드 WebSocket |
| `runner/` | Live Simulation 실행(한 번에 하나), OpenClaw chat 클라이언트, 대시보드 WebSocket |
| `common/` | 세 서비스가 같이 쓰는 토큰 인증, WebSocket 전달 |
| `homeconfig/` | `config/*.yaml` 로더와 검사 (토큰은 환경 변수에서 읽음) |
| `config/` | `agents.yaml`(호출자와 토큰 변수 이름), `devices.yaml`(HA 엔티티와 주인), `scenarios.yaml`(Live Simulation 시나리오) |
| `contracts/` | 대시보드가 받는 메시지 형식 (JSON Schema, 코드에서 생성) |
| `scripts/` | `verify_integration.py`(실행 중인 시스템 확인), `export_schemas.py` |
| `spikes/` | 초기 a2a-sdk 실험 (참고용, 실행 대상 아님) |

## 시작하기

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest

# 루트 .env(../scripts/setup.sh가 만듦: 에이전트 토큰, HA_URL, HA_TOKEN, DASHBOARD_TOKEN)를 읽는다
uvicorn gateway.main:build --factory --port 8100 --env-file ../.env
uvicorn collector.main:build --factory --port 8200 --env-file ../.env
uvicorn runner.main:build --factory --port 8300 --env-file ../.env   # SIMULATOR_TOKEN, OPENCLAW_GATEWAY_TOKEN 필요
```

브라우저 대시보드가 프록시 없이 직접 읽게 하려면 `.env`에 `AMBIENT_CORS_ORIGINS=http://localhost:5173`을 넣는다(GET만 허용).

`collector/events.py`, `gateway/stream.py`, `runner/stream.py`, 시나리오 모델을 바꾸면 `python scripts/export_schemas.py`로 `contracts/`를 갱신한다.

### Runner (Live Simulation)

- 에이전트마다 OpenClaw chat 엔드포인트가 켜져 있어야 한다. `agents/gateway.json5`의
  `http: { endpoints: { chatCompletions: { enabled: true } } }`로 다섯 에이전트 모두 켜져 있다(`scripts/say.sh`도 같은 엔드포인트를 쓴다).
  꺼져 있으면 실행 단계가 "chat endpoint is off"로 실패한다.
- `POST /runs`(시뮬레이터 토큰만): `{"scenario": "meeting"}` 또는 `{"agent": "desktop", "say": "나 회의 시작할게"}`. 답은 202와 실행 정보,
  진행 중인 실행이 있으면 409. 진행 상황은 `WebSocket /ws?token=`(대시보드·시뮬레이터 토큰)이나 `GET /runs/{id}`.
- 에이전트가 실제로 한 일(A2A 통신, 기기 실행, 거절 사유)은 Runner가 아니라 Collector·Gateway에 평소처럼 쌓인다.
  실행의 `started_at` 이후 기록을 보면 된다.
