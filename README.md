# SWE-Final — A2A based Agentic Home

A2A 프로토콜 확장(Ambient-A2A)을 통한 사용자 정보 공유 및 분산 스마트홈 제어 시스템 (한양대 CSE406 · LG전자 IC-PBL "Proactive Agentic Home").

## 레포 구성

| 폴더 | 내용 |
|---|---|
| [agents/](agents/) | OpenClaw 에이전트 5개와 공용 Ambient-A2A 플러그인 |
| [spec/](spec/) | Ambient-A2A 확장 명세 |
| [homeassistant/](homeassistant/) | Home Assistant 가상 기기와 Lovelace 대시보드 |
| [scripts/](scripts/) | 설치·실행·검증 스크립트 |
| [services/](services/) | Device Gateway(HA 앞에서 기기 주인을 다시 확인), Event Collector(모든 에이전트의 통신 기록) — Python |
| [frontend/](frontend/) | 스마트홈 시뮬레이터 화면 — React. LIVE(실제 데이터)/MOCK 전환: [docs/frontend-integration.md](docs/frontend-integration.md) |
| [docs/](docs/) | 실행 가이드(`RUN.md`), 프로젝트 맥락(`HANDOFF.md`), 에이전트와 services 연동(`integration.md`), services 아키텍처(`architecture-services.md`, 영문), 검증 결과 보고서(`verification-report.md`), 응답 속도 측정(`performance.md`), EXAONE 학습 실험(`dpo-experiment.md`) |
| [tools/](tools/) | `sync_upstream.sh`: 예전 A2A-agents 동기화 도구(2026-10-18부터 쓰지 않음) |
| [plan.md](plan.md) | 기획서 |

SWE26-01의 A2A-agents(루트), a2a-agentic-home(`services/`), SWE-frontend(`frontend/`)를 커밋 기록째 합친 레포다.
2026-10-18부터 에이전트를 포함한 모든 작업을 이 레포에서 바로 한다 ([docs/HANDOFF.md](docs/HANDOFF.md)).

## 에이전트

OpenClaw 에이전트 5개가 A2A v1.0에 **Ambient-A2A 확장**([spec/ambient-a2a.md](spec/ambient-a2a.md))을 얹어 서로 소통한다. 확장은 상태 공유·구독, 공간별 소유권, 정책 기반 협업을 정의한다. 설계 배경은 [plan.md](plan.md)에 있다.

| Agent | 역할 | 포트 | 사용자 입력 | 공개 정보 / 소유 기기 |
|---|---|---|---|---|
| `externel/desktop` | external | 18800 | OpenClaw CLI / Control UI | `meeting_app_active`, `pc_state` |
| `externel/smartphone` | external | 18920 | OpenClaw 메신저 채널(예: Telegram) | `presence` |
| `internel/orchestrator` | home | 19040 | CLI | 거실 조명, TV, TV 음소거 |
| `internel/room1` | room (My Room) | 19160 | CLI | 내 방 조명, 조명 모드, 에어컨, 재실 |
| `internel/room2` | room (수면 정책 방) | 19280 | CLI | 보호 방 조명, 에어컨, 수면 모드 |

```
desktop ──"회의 시작"──▶ orchestrator ──(요청자 ACL 확인)──▶ room1 (자기 규칙으로 승인/거절)
   ▲                         │
   └──── context.query ──────┘   (home이 external 정보를 조회. 허용된 필드만 반환)
```

## 구조
- [agents/ambient-a2a-plugin/](agents/ambient-a2a-plugin/): 5개 인스턴스가 공유하는 OpenClaw 플러그인(TS). `role` 설정으로 동작이 갈린다.
  - [src/core.ts](agents/ambient-a2a-plugin/src/core.ts): ACL, 소유권, 정책, sequence와 만료 판단. I/O가 없는 순수 로직.
  - [src/agent.ts](agents/ambient-a2a-plugin/src/agent.ts): 수신 처리, 위임, 자동화 규칙, 구독.
  - [src/a2a.ts](agents/ambient-a2a-plugin/src/a2a.ts): Agent Card와 JSON-RPC wire 형식.
  - [src/ha.ts](agents/ambient-a2a-plugin/src/ha.ts): Home Assistant 클라이언트. 소유한 엔티티만 제어할 수 있다.
  - [index.ts](agents/ambient-a2a-plugin/index.ts): OpenClaw에 HTTP 라우트(`/plugins/ambient/...`), tool, 서비스를 등록한다.
- `agents/{externel,internel}/*/openclaw.json5`: 프로필별 설정(소유 기기, ACL, 정책, 규칙). `AGENTS.md`는 LLM 역할 지침이다.
- [homeassistant/](homeassistant/): 가상 기기(`input_*` helper)와 Lovelace 대시보드. 실제 기기 연동은 없다.
- [scripts/](scripts/): 실행·검증 도구.
  - `oc.sh`: 프로필별 openclaw 실행
  - `run_all.sh`: HA와 게이트웨이 5개 기동
  - `logs.sh`: 이벤트 로그 확인
  - `scenario.sh`: 검증 시나리오
  - `say.sh`: 실행 중인 에이전트에 자연어 한 턴 보내기(HTTP, 빠른 경로)
  - `a2a_probe.py`: 표준 a2a-sdk 클라이언트

LLM(OpenClaw)은 사용자 의도를 해석해 `ambient_*` tool을 호출하는 역할만 한다. 정책, 소유권, 만료 판단은 플러그인 코드가 결정적으로 처리한다.

## 준비
```bash
scripts/setup.sh    # 최초 1회. 다시 실행해도 안전함
```
`setup.sh`가 하는 일:
- nvm으로 Node 24를 설치하고, OpenClaw `2026.10.4`를 설치한다.
- 플러그인 의존성과 Python probe용 venv(`.venv`)를 준비한다.
- `.env`를 만들고 에이전트 토큰을 랜덤 값으로 채운다.
- Home Assistant 컨테이너를 띄운 뒤 온보딩을 자동으로 마치고, 장기 토큰을 발급해 `.env`에 저장한다. HA 로그인 계정은 `admin` / `.env`의 `HA_ADMIN_PASSWORD`다.

그다음 `.env`에 **`OPENROUTER_API_KEY`** 만 직접 넣으면 된다.
- 모델은 `AMBIENT_MODEL`로 정한다(기본값 `openrouter/anthropic/claude-haiku-5.5`, 턴당 약 $0.0006). 더 정확한 답이 필요하면 `openrouter/anthropic/claude-sonnet-5-5`로 바꾼다(약 20~35배 비쌈).
- tool calling을 지원하는 모델을 골라야 한다. `openrouter/auto`는 피한다.

(선택) 폰 입력: `scripts/oc.sh smartphone channels add --channel telegram --token <bot-token>`

(선택) Device Gateway·Event Collector(SWE-Final `services/`): `.env`에 `AMBIENT_GATEWAY_URL`(예: `http://127.0.0.1:8100`), `AMBIENT_COLLECTOR_URL`(예: `http://127.0.0.1:8200`)을 넣으면 에이전트가 HA 대신 Gateway를 자기 토큰으로 부르고, 이벤트 로그를 Collector로도 보낸다. 비워 두면 지금처럼 HA를 직접 쓴다.

> OpenClaw의 파일 보안 검사가 한글(NFD) 경로를 거부한다. 그래서 `scripts/oc.sh`가 `agents/`를 `~/.ambient-a2a/app`으로 미러링해서 실행하고, 게이트웨이 state도 `~/.ambient-a2a/state/<agent>`에 둔다. 수정은 항상 레포에서 하면 된다. 다음 실행 때 자동으로 동기화된다.

## 실행
```bash
scripts/run_all.sh          # 터미널 1: HA + 게이트웨이 5개 (기동 확인까지 출력)
scripts/logs.sh             # 터미널 2: A2A 이벤트 로그
scripts/scenario.sh         # 터미널 3: 결정적 검증 (a2a-sdk)
scripts/scenario.sh --llm   #   + 자연어 흐름 ("나 회의 시작할게", "집 전체 절전해도 돼?")
scripts/scenario.sh --kill-home   # Home 중단 후에도 room1이 독립적으로 동작하는지 확인
```
대시보드: http://127.0.0.1:8123/ambient-home

Device Gateway·Event Collector (`services/`): `scripts/run_all.sh`가 함께 띄우고 에이전트가 쓰게 한다(`AMBIENT_SERVICES=off`로 끔).
```bash
python services/scripts/verify_integration.py --env-file .env   # 실행 중인 시스템 확인
```
요청 단위 흐름은 Collector `GET /flows`, 자세한 내용은 [docs/integration.md](docs/integration.md).

시뮬레이터 화면: `cp frontend/.env.example frontend/.env.local`(토큰 입력) 후 `cd frontend && npm ci && npm run dev` (http://localhost:5173). 오른쪽 위 LIVE/MOCK으로 실제 데이터와 데모 데이터를 전환

직접 말 걸기: `scripts/say.sh desktop "나 회의 시작할게"` (CLI로는 `scripts/oc.sh desktop agent --agent main --message ...`, 매번 CLI를 띄워 2~3초 더 걸린다)

설치부터 데모까지의 자세한 순서와 문제 해결은 [docs/RUN.md](docs/RUN.md)에 있다.

## 검증 항목 (plan.md 8.3)
| 항목 | 시나리오 |
|---|---|
| 외부 상태 전달 | 구독 → `context.update` → room1 조명 회의 모드 |
| 허용되지 않은 조회 차단 | home의 `pc_state` 조회 → `FIELD_NOT_ALLOWED`, 잘못된 토큰 → `UNAUTHORIZED` |
| 만료·역순 데이터 무시 | sequence 역행 또는 만료 → `STALE` |
| 자기 기기만 직접 제어 | room1이 거실 TV 제어 → `NOT_OWNER`, home은 room 기기를 위임(`delegated_to`) |
| 안전 정책 거절 | room2 수면 중 에어컨 끄기 → `SAFETY_POLICY` |
| Home 중단 시 독립 동작 | `--kill-home` |
| 집 전체 협업 | 전체 절전 → room1 실행, room2 일부 거절 → home이 `PARTIAL`로 취합 |
| 신규 Agent 연결 | home은 room Agent Card의 `owned_devices`로 소유권을 자동 학습 |

## 알려진 한계
- 토큰은 에이전트당 하나이고 피어끼리 공유한다. 상호 신뢰하지 않는 환경이라면 쌍별 토큰이나 mTLS로 바꿔야 한다.
- HA에는 엔티티별 ACL이 없다. 기기 단의 권한 검사는 플러그인 화이트리스트로 대신한다. `services/`의 Device Gateway가 이와 독립된 두 번째 검사를 맡는다(연결 방법: [docs/integration.md](docs/integration.md)).
- 구독 정보는 publisher 메모리에만 있다. external을 재시작하면 구독하던 쪽도 재시작해야 한다.
