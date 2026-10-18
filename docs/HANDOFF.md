# 프로젝트 맥락 (인수인계)

새 세션이나 새 팀원이 이 프로젝트를 이어받을 때 먼저 읽는 문서. 결정이 바뀌면 여기를 고친다.

## 무엇을 만드나

**A2A based Agentic Home**: A2A 프로토콜 확장(Ambient-A2A)을 통한 사용자 정보 공유 및 분산 스마트홈 제어 시스템.
한양대 CSE406 소프트웨어공학 Phase 2 텀 프로젝트이고, 주제는 LG전자 IC-PBL "Proactive Agentic Home"이다. 학기 말에 LG 데모를 한다.

- 기획서: 루트 `plan.md`. 세부 기획서: https://claude.ai/code/artifact/149b9ec3-d478-4a2e-8de2-2b0fb944c111

## 레포 구성 (2026-10-18 통합)

팀 레포 세 개를 커밋 기록째 이 레포(SWE26-01/SWE-Final) 하나로 합쳤다.

**작업 흐름**
- **2026-10-18부터 모든 작업을 SWE-Final에서 한다.** 에이전트 경로(`agents/`, `spec/`, `homeassistant/`, `scripts/`, `plan.md`)도 여기서 바로 고친다.
  A2A-agents는 이 시점까지의 커밋이 모두 들어온 상태(미반영 0건)에서 개발을 멈췄다. 그쪽에 PR을 올리지 않고, `tools/sync_upstream.sh`도 더 쓰지 않는다.
- 프론트(SWE-frontend)와 a2a-agentic-home도 더 이상 쓰지 않는다. `frontend/`, `services/`도 여기서 바로 작업한다.
- 각자 브랜치에서 작업하고 PR로 `main`에 합친다(예: `nsu102/dev`, `frontend`).

| 폴더 | 원래 레포 | 담당 | 내용 |
| --- | --- | --- | --- |
| 루트 (`agents/`, `spec/`, `homeassistant/`, `scripts/`, `plan.md`) | A2A-agents (개발 중단, 이제 여기서 작업) | nsu102 | 에이전트 5개를 OpenClaw로: desktop, smartphone, orchestrator(=Home), room1(=My Room), room2(수면 정책 방). TS 플러그인 `ambient-a2a`에 확장 규칙이 들어 있다 |
| `services/` | a2a-agentic-home | jwsong05, sjounng | Device Gateway(HA 앞 주인 재확인), Event Collector(통신 기록 모음), 연동 확인 |
| `frontend/` | SWE-frontend (연결 끊음) | lahee3423(원작), 실제 데이터 연결은 SWE-Final 관리자 | 시뮬레이터 화면(React). 실제 데이터 연결 방법: `docs/frontend-integration.md` |

`services/`는 처음에 Python(a2a-sdk) 에이전트를 만들다가, A2A-agents가 같은 시스템을 OpenClaw로 먼저 끝까지 구현해서
에이전트를 그쪽으로 일원화하고 Gateway·Collector만 남겼다.

## 확정된 결정

- **예측 모델은 만들지 않는다.** 외부 기기의 현재 상태와 공간별 정책으로 판단한다.
- **LLM**: 모든 에이전트가 LLM을 쓰고, 에이전트마다 다른 컨텍스트(역할 지침 `AGENTS.md`, 자기 상태)를 가진다.
  로컬인지 클라우드인지는 고정하지 않는다. 지금은 OpenRouter(`AMBIENT_MODEL`)이고 에이전트별로 바꿀 수 있다.
- **분산 제어**: 각 기기는 담당 에이전트가 하나다. Home도 방 기기는 주인 에이전트에게 넘기기만 한다(`on_behalf_of`).
- **원본 개인 데이터(일정 제목, GPS)는 에이전트 밖으로 보내지 않는다.** 에이전트는 `provides` 항목만 요청자 ACL에 맞춰 공개하고,
  Collector는 정해진 필드만 저장하며, Gateway는 `services/config/devices.yaml`에 있는 엔티티만 보여 준다.
- **에이전트는 Gateway를 거쳐 HA를 쓰고, 기록을 Collector로 보낸다.** SWE-Final에서는 `scripts/run_all.sh`가 둘을 함께 띄워 기본으로 켜진다
  (`AMBIENT_SERVICES=off`로 끔, A2A-agents#1·#2). 켜면 에이전트는 HA 토큰 대신 자기 토큰을 쓰고, HA 토큰은 Gateway와 설정 스크립트만 쓴다.
- **요청 하나는 `request_id` 하나로 끝까지 추적한다**(위임 = 같은 id, 절전 = `<id>/<room>`, 규칙 = 새 id, A2A-agents#3). Collector `GET /flows`가 이걸로 묶는다.
- **대시보드는 `frontend/`에서 만든다.** 데이터는 `services/`(Gateway·Collector)에서만 읽는다(`docs/frontend-integration.md`).

## 아직 정할 것

- **방 LLM의 판단 범위**: 지금 LLM은 사람이 그 에이전트에게 말할 때만 일한다. 다른 에이전트가 보낸 요청은
  플러그인 코드의 규칙이 LLM 없이 처리한다. "방 LLM이 요청을 보고 판단하고 규칙이 마지막에 막는" 구조로 바꿀지 정해야 한다.
- **사용자 승인(Human Approval, P1)**: 아직 없다. 메시지 규칙과 흐름은 에이전트 쪽, 승인 토큰 검사와 기록은 `services/` 쪽.
- **services/ 범위 확대 후보**: 사용자 승인 전체, 검증 자동화 + LLM 안전성 평가, Python 방 에이전트(상호 운용성), Desktop 실제 신호.

## services/ 구현 메모

- Gateway는 HA REST API와 같은 경로를 받는다(`GET /api/states/<entity>`, `POST /api/services/<domain>/<service>`).
  그래서 플러그인의 `ha.ts`는 고치지 않고 주소와 토큰만 바꾸면 된다. 허용하는 서비스는 `input_boolean` on/off/toggle,
  `input_select.select_option`, `input_number.set_value`뿐이다. `entity_id`의 쉼표 목록과 `all`도 하나씩 검사한다.
- Gateway는 HA WebSocket(`state_changed`)을 구독한다. 다시 연결되면 전체 상태를 다시 읽어 대시보드에 `snapshot`을 다시 보낸다.
- 테스트는 가짜 HA(`httpx.MockTransport`, 가짜 WebSocket)로 돌아서 CI에 HA가 필요 없다.
- 실제 환경 확인(2026-10-18, 로컬): HA + 에이전트 5개 + `services/docker-compose.yml`로 띄운 Gateway·Collector에서
  `scripts/scenario.sh` 결과가 그대로이고, `services/scripts/verify_integration.py` 세 항목이 모두 통과했다.
- `scripts/setup.sh`를 HA 초기 설정 뒤에 다시 돌리면 멈추던 문제는 A2A-agents#2에서 고쳤다.

## 사전 실험에서 확인한 것 (A2A v1.0, a2a-sdk 1.2.2)

- v0.3 메서드 이름(`message/send`)은 v1.0 서버에서 `Method not found`. 인터넷 예제와 AI 생성 코드 대부분이 v0.3이다.
- metadata·DataPart 값은 protobuf Struct를 거치면서 정수가 실수가 된다(42 → 42.0). Python a2a-sdk와 주고받는 숫자에 주의.
- 권한 검사를 에이전트 로직 안에서만 하면 Task 조회·취소로 우회될 수 있다. HTTP 계층에서 토큰으로 막아야 한다.
- 에이전트 사이 왕복 지연은 로컬에서 약 20ms이고, 느려지는 원인은 LLM 호출뿐이다.

## 현재 상태

- 에이전트 5개, Ambient-A2A 확장 1~4, HA 가상 기기, 검증 시나리오: 동작한다(`scripts/scenario.sh`).
- services: Gateway·Collector(요청 단위 흐름 `GET /flows` 포함)·연동 확인 스크립트 완료, 에이전트와 연결 완료(검증 통과),
  아키텍처 문서 초안 `docs/architecture-services.md`(영문, #5의 services 부분), 검증 결과 보고서 `docs/verification-report.md`(#6).
- 응답 속도: 사람이 에이전트에게 말한 한 턴이 약 11초에서 6초로 줄었다(tool 직접 노출, 프롬프트 축소, 추론 끔, `scripts/say.sh`). 측정과 바꾼 설정은 `docs/performance.md`.
- frontend: LIVE/MOCK 전환. LIVE에서 Home·3D Model·Agent Activity 탭이 Gateway·Collector의 실제 데이터를 보여 준다(`frontend/src/live/`).
  에이전트 카드는 Collector가 5초마다 Agent Card를 확인한 실제 상태다(`GET /agents`, WebSocket `agents`).
  Live Simulation·Control Mode 탭은 데모용 가짜 데이터. 화면에서 기기 조작은 막혀 있다(대시보드 토큰은 읽기 전용).
- 다음(services): 사용자 승인 토큰 검사(#2, 승인 방식이 정해진 뒤). 검증 보고서의 한계 항목(새 방 연결 시험 등)은 필요할 때 보강.
