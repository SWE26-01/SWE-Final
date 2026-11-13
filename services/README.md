# services — Device Gateway · Event Collector

가상 기기(Home Assistant) 앞에서 두 가지를 맡는 Python 서비스. Hub처럼 새로 만드는 Python 서비스도 여기에 추가한다
(제안서 `../docs/PROPOSAL.md`, 맥락 `../docs/HANDOFF.md`).

- **Device Gateway** (`gateway/`): 에이전트는 Home Assistant 대신 Gateway를 부른다. Gateway는 요청한 에이전트가 그 기기의
  주인인지 다시 확인하고, 통과한 명령만 HA에 넘긴다. 대시보드에는 기기 상태를 WebSocket으로 보낸다.
- **Event Collector** (`collector/`): 모든 에이전트의 A2A 통신·실행·자동화 기록을 한곳에 모으고 대시보드에 실시간으로 보낸다.

## 구조

| 폴더 | 내용 |
| --- | --- |
| `gateway/` | HA 프록시(주인 검사), HA 상태 스트림, 대시보드 WebSocket |
| `collector/` | 이벤트 저장(SQLite), 조회, 대시보드 WebSocket |
| `common/` | 서비스들이 같이 쓰는 토큰 인증, WebSocket 전달 |
| `homeconfig/` | `config/*.yaml` 로더와 검사 (토큰은 환경 변수에서 읽음) |
| `config/` | `agents.yaml`(호출자와 토큰 변수 이름), `devices.yaml`(HA 엔티티와 주인) |
| `contracts/` | 대시보드가 받는 메시지 형식 (JSON Schema, 코드에서 생성) |
| `scripts/` | `export_schemas.py` |

## 시작하기

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest   # 테스트는 자체 설정(tests/config)을 쓰고, 실제 설정은 tests/test_homeconfig.py가 확인한다

# 루트 .env(../scripts/setup.sh가 만듦: 에이전트 토큰, HA_URL, HA_TOKEN, DASHBOARD_TOKEN)를 읽는다
uvicorn gateway.main:build --factory --port 8100 --env-file ../.env
uvicorn collector.main:build --factory --port 8200 --env-file ../.env
```

브라우저 대시보드가 프록시 없이 직접 읽게 하려면 `.env`에 `AMBIENT_CORS_ORIGINS=http://localhost:5173`을 넣는다(GET만 허용).

`collector/events.py`, `collector/flows.py`, `collector/agents.py`, `gateway/stream.py`를 바꾸면 `python scripts/export_schemas.py`로 `contracts/`를 갱신한다.
