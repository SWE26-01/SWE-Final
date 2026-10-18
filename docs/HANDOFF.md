# 프로젝트 맥락 (인수인계)

새 세션이나 새 팀원이 이 프로젝트를 이어받을 때 먼저 읽는 문서. 결정이 바뀌면 여기를 고친다.

## 무엇을 만드나

**A2A based Agentic Home**: A2A 프로토콜 확장(Ambient-A2A)을 통한 사용자 정보 공유 및 분산 스마트홈 제어 시스템.
한양대 CSE406 소프트웨어공학 Phase 2 텀 프로젝트이고, 주제는 LG전자 IC-PBL "Proactive Agentic Home"이다. 학기 말에 LG 데모를 한다.

- 기획서: 루트 `plan.md`. 세부 기획서: https://claude.ai/code/artifact/149b9ec3-d478-4a2e-8de2-2b0fb944c111

## 레포 구성 (2026-10-18 통합)

팀 레포 세 개를 커밋 기록째 이 레포(SWE26-01/SWE-Final) 하나로 합쳤다. 옛 레포는 그대로 남아 있지만 앞으로의 작업은 여기서 한다.

| 폴더 | 원래 레포 | 담당 | 내용 |
| --- | --- | --- | --- |
| 루트 (`agents/`, `spec/`, `homeassistant/`, `scripts/`, `plan.md`) | A2A-agents | nsu102 | 에이전트 5개를 OpenClaw로: desktop, smartphone, orchestrator(=Home), room1(=My Room), room2(수면 정책 방). TS 플러그인 `ambient-a2a`에 확장 규칙이 들어 있다 |
| `services/` | a2a-agentic-home | jwsong05, sjounng | Device Gateway(HA 앞 주인 재확인), Event Collector(통신 기록 모음), 연동 확인 |
| `frontend/` | SWE-frontend | lahee3423 | 시뮬레이터 화면(React). 대시보드 통합도 이쪽에서 한다 |

`services/`는 처음에 Python(a2a-sdk) 에이전트를 만들다가, A2A-agents가 같은 시스템을 OpenClaw로 먼저 끝까지 구현해서
에이전트를 그쪽으로 일원화하고 Gateway·Collector만 남겼다.

## 확정된 결정

- **예측 모델은 만들지 않는다.** 외부 기기의 현재 상태와 공간별 정책으로 판단한다.
- **LLM**: 모든 에이전트가 LLM을 쓰고, 에이전트마다 다른 컨텍스트(역할 지침 `AGENTS.md`, 자기 상태)를 가진다.
  로컬인지 클라우드인지는 고정하지 않는다. 지금은 OpenRouter(`AMBIENT_MODEL`)이고 에이전트별로 바꿀 수 있다.
- **분산 제어**: 각 기기는 담당 에이전트가 하나다. Home도 방 기기는 주인 에이전트에게 넘기기만 한다(`on_behalf_of`).
- **원본 개인 데이터(일정 제목, GPS)는 에이전트 밖으로 보내지 않는다.** 에이전트는 `provides` 항목만 요청자 ACL에 맞춰 공개하고,
  Collector는 정해진 필드만 저장하며, Gateway는 `services/config/devices.yaml`에 있는 엔티티만 보여 준다.
- **HA 토큰은 Gateway만 가진다**(목표). 에이전트는 자기 토큰으로 Gateway를 부르고, 기록은 에이전트가 Collector로 보낸다.
  에이전트 쪽 변경은 `docs/integration.md`에 있고 아직 적용 전이다(담당자 합의 필요).
- **대시보드는 frontend 쪽에서 합친다.** `services/`는 데이터(Gateway·Collector WebSocket, `services/contracts/`)만 제공한다.

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
  가짜 HA 서버로 실제 프로세스 확인을 했다(2026-10-18). 실제 HA와 에이전트를 붙인 확인은 에이전트 쪽 변경 후에 한다.

## 사전 실험에서 확인한 것 (A2A v1.0, a2a-sdk 1.2.2)

- v0.3 메서드 이름(`message/send`)은 v1.0 서버에서 `Method not found`. 인터넷 예제와 AI 생성 코드 대부분이 v0.3이다.
- metadata·DataPart 값은 protobuf Struct를 거치면서 정수가 실수가 된다(42 → 42.0). Python a2a-sdk와 주고받는 숫자에 주의.
- 권한 검사를 에이전트 로직 안에서만 하면 Task 조회·취소로 우회될 수 있다. HTTP 계층에서 토큰으로 막아야 한다.
- 에이전트 사이 왕복 지연은 로컬에서 약 20ms이고, 느려지는 원인은 LLM 호출뿐이다.

## 현재 상태

- 에이전트 5개, Ambient-A2A 확장 1~4, HA 가상 기기, 검증 시나리오: 동작한다(`scripts/scenario.sh`).
- services: Gateway·Collector·연동 확인 스크립트 완료. 에이전트와 연결은 아직이다.
- frontend: 가짜 데이터로 동작하는 화면. 실제 데이터 연결과 대시보드 통합은 frontend 쪽에서 한다.
- 다음: 에이전트 쪽 연동 변경 합의 → 실제 시스템으로 `verify_integration.py` 통과 → 사용자 승인 등 범위 결정.
