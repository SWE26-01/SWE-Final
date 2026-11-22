# 프로젝트 맥락 (인수인계)

새 세션이나 새 팀원이 이 프로젝트를 이어받을 때 먼저 읽는 문서. 결정이 바뀌면 여기를 고친다.

## 무엇을 만드나

**Extension of Smart Home: Internal & External Connectivity via A2A** (G01 | A2A-Lite). 집 안은 방 에이전트로 분산하고,
집 밖 에이전트와 A2A로 연결하며, Agentic Studio·Hub로 에이전트를 만들고 등록·연결한다.
한양대 CSE406 소프트웨어공학 Phase 2 텀 프로젝트이고, 주제는 LG전자 IC-PBL "Proactive Agentic Home"이다. 학기 말에 LG 데모를 한다.

- 기획서: 루트 `plan.md` (발표 자료 `docs/presentation/presentation.pdf` 기준, 2026-11-18). 슬라이드별 설명은 README.
- **주제 확장(2026-11-13)**: "Extension of Smart Home: Internal & External Connectivity via A2A". Main 1은 위의 A2A 스마트홈
  (내부 방 에이전트 + 외부 Desktop·Mobile 에이전트, 분산 제어) 그대로이고, Main 2로 **Agent Studio**(자연어 → 템플릿 기반 에이전트),
  **Agent Hub**(등록·검색·연결·권한)를 더한다. Skill Marketplace는 빼기로 했다(2026-11-16): 스킬은 `config/skills.yaml`의
  기본 스킬뿐이고 사용자가 고르지 않는다. 백엔드는 FastAPI + LangChain + OpenRouter + PostgreSQL(Docker).
  Studio가 만드는 에이전트는 지금 OpenClaw 프로필이고, Python 실행기로 바꿀 수 있게 실행기를 `studio/runtime.py` 하나로 모았다. Studio는 "구조를 짜고 빈칸을 채우는" 방식과 하네스(위험 명령·도구 차단)로 만든다.

## 레포 구성 (2026-10-18 통합)

팀 레포 세 개를 커밋 기록째 이 레포(SWE26-01/SWE-Final) 하나로 합쳤다.

**작업 흐름**
- **2026-10-18부터 모든 작업을 SWE-Final에서 한다.** A2A-agents, SWE-frontend, a2a-agentic-home은 더 이상 쓰지 않는다.
- 각자 브랜치에서 작업하고 이슈·PR로 `main`에 합친다.
- **2026-11-20 정리**: Home Assistant(`homeassistant/`), 예전 시뮬레이터 화면(`frontend/`), Live Simulation Runner(`services/runner`),
  동기화 도구(`tools/`), 초기 실험(`services/spikes`)을 지웠다. 기기는 Device Gateway가 직접 들고 있는 가상 집이고,
  루트 `docker-compose.yml` 하나로 전부 뜬다.

| 폴더 | 원래 레포 | 담당 | 내용 |
| --- | --- | --- | --- |
| 루트 (`agents/`, `spec/`, `scripts/`, `plan.md`) | A2A-agents (개발 중단, 이제 여기서 작업) | nsu102 | 에이전트 5개를 OpenClaw로: desktop, smartphone, root(=Root/Home), room1(=My Room), room2(수면 정책 방). TS 플러그인 `home-a2a`에 확장 규칙이 들어 있다 |
| `services/` | a2a-agentic-home | jwsong05, sjounng, jenny | Device Gateway(가상 집, 주인 확인), Event Collector(통신 기록 모음), Agent Hub, Agent Studio |
| `web/` | — | lahee3423 | 화면: shadcn/ui 모노레포 (Agent Cloud `apps/cloud`, 스마트홈 앱 `apps/home`) |

`services/`는 처음에 Python(a2a-sdk) 에이전트를 만들다가, A2A-agents가 같은 시스템을 OpenClaw로 먼저 끝까지 구현해서
에이전트를 그쪽으로 일원화하고 Gateway·Collector만 남겼다.

## 확정된 결정

- **예측 모델은 만들지 않는다.** 외부 기기의 현재 상태와 공간별 정책으로 판단한다.
- **LLM**: 모든 에이전트가 LLM을 쓰고, 에이전트마다 다른 컨텍스트(역할 지침 `AGENTS.md`, 자기 상태)를 가진다.
  로컬인지 클라우드인지는 고정하지 않는다. 지금은 OpenRouter의 `anthropic/claude-haiku-5.5`(`AGENT_MODEL`, 2026-10-19에 Sonnet 5.5에서 바꿈. 비교는 `docs/performance.md`)이고 에이전트별로 바꿀 수 있다.
- **분산 제어**: 각 기기는 담당 에이전트가 하나다. Home도 방 기기는 주인 에이전트에게 넘기기만 한다(`on_behalf_of`).
- **원본 개인 데이터(일정 제목, GPS)는 에이전트 밖으로 보내지 않는다.** 에이전트는 `provides` 항목만 요청자 ACL에 맞춰 공개하고,
  Collector는 정해진 필드만 저장한다.
- **기기는 Device Gateway의 가상 집에만 있다(2026-11-20, Home Assistant 제거).** 에이전트는 자기 토큰으로 Gateway를 부르고
  (HA REST와 같은 모양), 기록을 Collector로 보낸다. 상태는 Gateway 메모리에 있고 다시 시작하면 처음 상태로 돌아간다.
- **실행은 루트 `docker compose up -d --build` 하나로 한다.** 에이전트 5개는 한 컨테이너(`agents`)에서 돌아 서로 127.0.0.1로 부른다.
- **요청 하나는 `request_id` 하나로 끝까지 추적한다**(위임 = 같은 id, 절전 = `<id>/<room>`, 규칙 = 새 id, A2A-agents#3). Collector `GET /flows`가 이걸로 묶는다.
- **화면은 `web/`(shadcn/ui 모노레포, Turborepo + npm workspaces)이다(2026-11-22, 처음은 lahee3423/swe_AgentHub의 `agent_hub_FE`).**
  Agent Cloud는 `apps/cloud`(:3000), 스마트홈 앱은 `apps/home`(:3001)이고, 둘이 `packages/ui`(shadcn 컴포넌트)와 `packages/core`
  (프록시·세션·API 훅·이름표·에이전트 시트)를 같이 쓴다. 모든 데이터는 Next 서버 쪽 프록시
  (`app/api/[service]/[...path]`, 허용 목록 `web/packages/core/src/proxy.ts`)를 거친다. 토큰은 화면 서버에만 있다. 병원 이송 시뮬레이터는 없앴다.
- **스마트홈 앱은 `/home`이다(2026-11-22).** 시연용 폰 화면(공간·기기·외부 연결). Hub 화면과 같은 프록시·데이터·검색(`GET /agents?q=`)을 쓰고 기기는 읽기만 한다.
  기기 주인은 에이전트 연결로 바꾼다(기기 시트 → "이 기기를 맡을 수 있는 에이전트"). 기본 에이전트의 한국어 이름은 앱 안의 `HOME_NAMES`.
- **Hub 연결이 곧 실행이다(2026-11-21).** Studio 에이전트를 연결하면 실행기(`scripts/launcher.mjs`)가 띄우고, Gateway·Collector·플러그인은
  Hub(`/tokens/verify`, `/ownership`, `/runtime/*`)를 읽는다. Hub에 닿지 않으면 Gateway는 명령을 거절한다.
- **에이전트 간 메시지는 표준 A2A v1.0만 쓴다(2026-11-20, 확장 제거).** Agent Card는 표준 필드만 있고, 역할·공간·소유 기기·공유 필드는
  `skills[].tags`(`room`, `space:`, `device:`, `field:`)로 알린다.

## 아직 정할 것

- **방 LLM의 판단 범위**: 지금 LLM은 사람이 그 에이전트에게 말할 때만 일한다. 다른 에이전트가 보낸 요청은
  플러그인 코드의 규칙이 LLM 없이 처리한다. "방 LLM이 요청을 보고 판단하고 규칙이 마지막에 막는" 구조로 바꿀지 정해야 한다.
- **사용자 승인(Human Approval, P1)**: 아직 없다. 메시지 규칙과 흐름은 에이전트 쪽, 승인 토큰 검사와 기록은 `services/` 쪽.
- **services/ 범위 확대 후보**: 사용자 승인 전체, 검증 자동화 + LLM 안전성 평가, Python 방 에이전트(상호 운용성), Desktop 실제 신호.

## services/ 구현 메모

- Gateway는 HA REST API와 같은 경로를 받는다(`GET /api/states/<entity>`, `POST /api/services/<domain>/<service>`).
  그래서 플러그인의 `devices.ts`는 HA 클라이언트 모양 그대로다. 허용하는 서비스는 `input_boolean` on/off/toggle,
  `input_select.select_option`, `input_number.set_value`뿐이다. `entity_id`의 쉼표 목록과 `all`도 하나씩 검사한다.
- 기기 이름·옵션·처음 상태는 `services/config/devices.yaml`에 있다(예전 HA `configuration.yaml`에서 옮김).
- 실제 환경 확인(2026-11-20, `docker compose up`): `scripts/scenario.sh --kill-home`, `verify_integration.py`,
  `scripts/test_hub_studio.sh`(실제 LLM) 모두 통과.

## 사전 실험에서 확인한 것 (A2A v1.0, a2a-sdk 1.2.2)

- v0.3 메서드 이름(`message/send`)은 v1.0 서버에서 `Method not found`. 인터넷 예제와 AI 생성 코드 대부분이 v0.3이다.
- metadata·DataPart 값은 protobuf Struct를 거치면서 정수가 실수가 된다(42 → 42.0). Python a2a-sdk와 주고받는 숫자에 주의.
- 권한 검사를 에이전트 로직 안에서만 하면 Task 조회·취소로 우회될 수 있다. HTTP 계층에서 토큰으로 막아야 한다.
- 에이전트 사이 왕복 지연은 로컬에서 약 20ms이고, 느려지는 원인은 LLM 호출뿐이다.

## 현재 상태

- 에이전트 5개, Home A2A 확장 1~4, 가상 집(Gateway), 검증 시나리오: 동작한다(`scripts/scenario.sh`).
- services: Gateway·Collector(요청 단위 흐름 `GET /flows` 포함)·연동 확인 스크립트, 아키텍처 문서 `docs/architecture-services.md`(영문),
  검증 결과 보고서 `docs/verification-report.md`(2026-10-18 HA 시절 기록).
- 응답 속도: 사람이 에이전트에게 말한 한 턴이 약 11초에서 6초로 줄었다. 측정과 바꾼 설정은 `docs/performance.md`.
- EXAONE 4.0 1.2B 학습 실험(`training/`, 문서 `docs/dpo-experiment.md`): 발표의 "에이전트별 SLM"의 근거였지만, 2026-11-22에
  SLM 대신 Claude Haiku 호출(OpenRouter `anthropic/claude-haiku-5.5`)로 가기로 했다. 실험 기록으로만 남긴다.
- Agent Hub·Studio(`services/agenthub`, `services/studio`): Hub는 등록·검색·연결(기기마다 주인 하나, 에이전트별 토큰은 해시만 저장)·해제·토큰 확인,
  Studio는 요청 → 입력 차단 → LLM 빈칸 채우기(LangChain, OpenRouter) → 기본 스킬을 규칙으로 변환 → 실행기 파일 생성(지금 OpenClaw,
  `STUDIO_RUNTIME`으로 교체 가능) → 도구 잠금 검사 → 사용자 승인 → Hub 등록. HTTP 확인 `scripts/test_hub_studio.sh [--local]`(26단계).
  2026-11-21: 화면과 API 연결, 연결된 에이전트 실행(실행기), Gateway·Collector·플러그인의 Hub 확인까지 끝났다.
  2026-11-22: 계정(회원가입·로그인, 세션은 해시만 저장·화면 쪽 httpOnly 쿠키), 카탈로그(공유·별·설치 수), 계정별 Studio 초안,
  Collector를 PostgreSQL로(예전 SQLite 기록은 한 번 옮김). 사용자들은 같은 한 집을 쓴다(집마다 따로 나누지 않음).
  남은 것: 집(가구)별 분리, 클라우드 배포, OpenClaw 한 개당 약 1GB라 Studio 에이전트 수가 메모리에 묶이는 문제.
