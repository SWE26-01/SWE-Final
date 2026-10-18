# A2A based Agentic Home — Device Gateway · Event Collector

A2A 프로토콜 확장(Ambient-A2A)을 통한 사용자 정보 공유 및 분산 스마트홈 제어 시스템의 **기기 검문소와 통신 기록** 부분.

팀 레포 구성:

| 레포 | 내용 |
| --- | --- |
| [SWE26-01/A2A-agents](https://github.com/SWE26-01/A2A-agents) | 에이전트 5개(OpenClaw), Ambient-A2A 확장 명세, Home Assistant 가상 기기 |
| [SWE26-01/SWE-frontend](https://github.com/SWE26-01/SWE-frontend) | 스마트홈 시뮬레이터 화면 (React) |
| **이 레포** | Device Gateway, Event Collector, 연동 확인 |

- **Device Gateway** (`gateway/`): 에이전트는 Home Assistant 대신 Gateway를 부른다. Gateway는 요청한 에이전트가 그 기기의
  주인인지 다시 확인하고, 통과한 명령만 HA에 넘긴다. 대시보드에는 기기 상태를 WebSocket으로 보낸다.
- **Event Collector** (`collector/`): 모든 에이전트의 A2A 통신·실행·자동화 기록을 한곳에 모으고 대시보드에 실시간으로 보낸다.

연동 방법과 A2A-agents 쪽에서 바꿀 것: [docs/integration.md](docs/integration.md)

## 구조

| 폴더 | 내용 |
| --- | --- |
| `gateway/` | Device Gateway: HA 프록시(주인 검사), HA 상태 스트림, 대시보드 WebSocket |
| `collector/` | Event Collector: 이벤트 저장(SQLite), 조회, 대시보드 WebSocket |
| `common/` | 두 서비스가 같이 쓰는 토큰 인증, WebSocket 전달 |
| `homeconfig/` | `config/*.yaml` 로더와 검사 (토큰은 환경 변수에서 읽음) |
| `config/` | `agents.yaml`(호출자와 토큰 변수 이름), `devices.yaml`(HA 엔티티와 주인) |
| `contracts/` | 대시보드가 받는 메시지 형식 (JSON Schema, 코드에서 생성) |
| `scripts/` | `verify_integration.py`(실행 중인 시스템 확인), `export_schemas.py` |

## 시작하기

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest

# A2A-agents의 .env(에이전트 토큰, HA_URL, HA_TOKEN)에 DASHBOARD_TOKEN을 추가한 뒤
uvicorn gateway.main:build --factory --port 8100 --env-file ../A2A-agents/.env
uvicorn collector.main:build --factory --port 8200 --env-file ../A2A-agents/.env
```

## 규칙

- AI 코딩 도구는 `CLAUDE.md`(= `AGENTS.md`)의 규칙을 따른다.
- `collector/events.py`나 `gateway/stream.py`를 바꾸면 `python scripts/export_schemas.py`로 `contracts/`를 갱신한다.
- `main`에 직접 push하지 않고 PR로 올린다.
