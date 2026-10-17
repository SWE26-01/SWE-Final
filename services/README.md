# A2A based Agentic Home

A2A 프로토콜 확장(Ambient-A2A)을 통한 사용자 정보 공유 및 분산 스마트홈 제어 시스템.

- Desktop·Mobile Agent가 필요한 사용자 상태만 공유하고
- 방마다 Room Agent가 자기 기기의 제어 권한과 정책을 가지며
- 다른 Agent의 요청은 공간별 정책에 따라 수락·거절한다.

기획서: (팀 기획 문서 링크) · 3D 시뮬레이션: `a2a-agentic-home-3d`

## 구조

| 폴더 | 내용 | WBS |
| --- | --- | --- |
| `ambient/` | Ambient-A2A 메시지 스키마, 검증, 구독 관리, A2A 변환 | W1 |
| `agents/common` | Agent 서버 템플릿, 인증, 메시지 라우팅 | W2 |
| `agents/desktop` | Desktop Agent (호스트에서 실행) | W3 |
| `agents/mobile` | Mobile Agent + 휴대폰 웹페이지 | W4 |
| `agents/room` | Room Agent 템플릿 (my_room, baby_room, elderly_room) | W5, W7 |
| `agents/home` | Home Agent | W6 |
| `gateway/` | 가상 Device Gateway + 시나리오 재생 | W8 |
| `collector/` | Event Collector | W8 |
| `dashboard/` | React 대시보드 | W9 |
| `contracts/` | Agent 간 메시지와 3D 연동 명세 (JSON Schema) | - |
| `config/` | agents / policies / devices / scenarios | W0 |

## 시작하기

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
uvicorn gateway.main:app --port 8100
```

## 규칙

- AI 코딩 도구는 `CLAUDE.md`(= `AGENTS.md`)의 규칙을 따른다. A2A v1.0만 사용.
- `ambient/schemas.py`를 바꾸면 `python scripts/export_schemas.py`로 `contracts/`를 갱신한다.
- `main`에 직접 push하지 않고 PR로 올린다. PR 제목에 WBS ID를 적는다 (예: `[W1-2] context validator`).
