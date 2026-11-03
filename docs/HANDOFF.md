# 프로젝트 맥락 (인수인계)

새 세션이나 새 팀원이 이 프로젝트를 이어받을 때 먼저 읽는 문서. 결정이 바뀌면 여기를 고친다.

## 무엇을 만드나

**Agent Hub & Studio**: A2A 기반 스마트홈 에이전트 생성·연결 플랫폼. 개발 계획은 루트 `AGENT_HUB_STUDIO_DEV_PLAN.md`.
한양대 CSE406 소프트웨어공학 텀 프로젝트이고, 주제는 LG전자 IC-PBL "Proactive Agentic Home"이다. 학기 말에 LG 데모를 한다.

- Studio: 자연어 요구 → 확인 질문 → 구조화된 에이전트 명세(`AgentSpec`) → 검증·미리보기
- Hub: 명세와 실행 주소 등록, 탐색, 연결 승인(`ConnectionBinding`), 중지·연결 해제
- 공통 실행기가 명세를 실행하고, 생성된 에이전트는 Home Agent와 A2A로 작업을 주고받는다(Home-A2A: 상태 구독, 환경 변경 요청)
- 첫 시연: 운동 코치 에이전트(`session_assistant` 템플릿) + 가상 스마트홈

## 피봇 (브랜치 `hub-studio`)

A2A based Agentic Home(OpenClaw 에이전트 5개가 Ambient-A2A 확장으로 상태를 공유하고 방별로 기기를 나눠 제어)에서 방향을 바꿨다.

- 2026-11-02: OpenClaw 에이전트와 TS 플러그인(`agents/`), Ambient-A2A 명세(`spec/`), Runner(`services/runner`),
  a2a-sdk 실험(`services/spikes`), EXAONE 학습 실험(`training/`), 예전 기획서(`plan.md`)와 실행·검증·성능 문서를 지웠다.
- 2026-11-03: 시뮬레이터 화면(`frontend/`)과 그 연결 문서, 시뮬레이터 토큰 역할, Collector의 Ambient-A2A Agent Card 해석,
  예전 샘플 메시지(`services/contracts/examples`)를 지우고, 가상 집을 새 시나리오로 바꿨다.

지운 것은 모두 피봇 직전 커밋 `216840e`에 있다. 예: `git show 216840e:services/spikes/02_subscription_scope_chain.py`
(a2a-sdk 1.2.2 서버·클라이언트 예제), `git show 216840e:frontend/src/Home3D.jsx`(3D 집 화면).

## 확정된 결정

- **실행기와 Home Agent는 Python으로 새로 만든다(OpenClaw를 쓰지 않음, 2026-11-02).** 생성된 에이전트는 명세 인스턴스라서
  Python 프로세스 하나가 a2a-sdk로 여러 개를 띄우는 편이 맞다. OpenClaw는 에이전트마다 Node 프로세스(약 1.2GB)가 떠야 하고,
  세션·타이머 로직도 결국 TS 플러그인 코드로 써야 했다. 생성 서비스·Hub·검증기와 언어도 맞춘다.
- **가상 기기는 Home Assistant + Device Gateway를 쓴다(2026-11-02).** 집은 거실 하나다(2026-11-03): 재실, 온도, 조명과 밝기,
  에어컨과 희망 온도, TV. 기기 주인은 Home Agent(`home`) 하나이고, 다른 에이전트는 Home Agent에 A2A로 부탁한다.
  시뮬레이터 화면이 생기기 전까지는 HA의 Ambient Home 대시보드에서 재실·온도·TV를 바꿔 사용자 역할을 한다.
- **새 Python 구성 요소는 `services/`에 넣는다.** pyproject, CI(ruff, pytest, contracts 검사), Dockerfile, 토큰 인증(`common/auth.py`)을 같이 쓴다.
- **화면은 처음부터 새로 만든다(2026-11-03).** 예전 시뮬레이터(`frontend/`, JSX)는 지웠다. Studio·Hub·시뮬레이터는 React + TypeScript로 만들고,
  3D 집이 필요하면 `216840e`에서 가져온다.
- Event Collector는 통합 로그와 요청 ID 추적에 쓴다. 이벤트 형식(`collector/events.py`)은 Home-A2A를 정할 때 같이 고친다.
- 계획서의 원칙: LLM은 명세(와 실행 중 안내 문구)만 만든다. 인증·권한·타이머·세션 전이는 코드가 한다.
  Agent Card는 검증된 명세와 실행 주소에서 결정적으로 만든다. 명세와 집별 연결 정보·자격 증명은 분리한다.

## 아직 정할 것

- 생성 모델: Claude와 Gemini 중 구조화 출력을 쓸 모델 하나(계획서 4장). 모델 ID·옵션은 설정에 기록하고 실험 중 고정한다.
- A2A SDK 버전 고정: 사전 실험은 a2a-sdk 1.2.2로 했다(아래).
- Hub 인증 방식과 연결 해제 시 토큰 무효화 방법(MVP는 통제된 개발 네트워크). 지금 Gateway·Collector의 호출자는
  `services/config/agents.yaml`의 고정 목록이라, 생성된 에이전트가 Collector에 기록하려면 Hub가 발급한 토큰을 받아들이게 바꿔야 한다.
- 화면 구성: Studio·Hub·시뮬레이터를 React 앱 하나로 둘지.

## 사전 실험에서 확인한 것 (A2A v1.0, a2a-sdk 1.2.2)

- v0.3 메서드 이름(`message/send`)은 v1.0 서버에서 `Method not found`. 인터넷 예제와 AI 생성 코드 대부분이 v0.3이다.
- metadata·DataPart 값은 protobuf Struct를 거치면서 정수가 실수가 된다(42 → 42.0). Python a2a-sdk와 주고받는 숫자에 주의.
- 권한 검사를 에이전트 로직 안에서만 하면 Task 조회·취소로 우회될 수 있다. HTTP 계층에서 토큰으로 막아야 한다.
- 에이전트 사이 왕복 지연은 로컬에서 약 20ms이고, 느려지는 원인은 LLM 호출뿐이다.

## services/ 구현 메모

- Gateway는 HA REST API와 같은 경로를 받는다(`GET /api/states/<entity>`, `POST /api/services/<domain>/<service>`).
  그래서 HA 클라이언트는 주소와 토큰만 바꾸면 된다. 허용하는 서비스는 `input_boolean` on/off/toggle과
  `input_number.set_value`뿐이다. `entity_id`의 쉼표 목록과 `all`도 하나씩 검사한다.
- Gateway는 HA WebSocket(`state_changed`)을 구독한다. 다시 연결되면 전체 상태를 다시 읽어 대시보드에 `snapshot`을 다시 보낸다.
  Home Agent가 재실·온도 변화를 받으려면 이 스트림을 에이전트에게도 열어야 한다(지금은 대시보드 토큰만).
- 테스트는 가짜 HA(`httpx.MockTransport`, 가짜 WebSocket)와 자체 설정(`services/tests/config`: `home`과 기기 없는 `coach`)으로 돈다.
  실제 설정은 `test_homeconfig.py`가 확인하고, HA 설정의 helper와 `devices.yaml`이 같은지도 본다.
- Collector는 정해진 필드만 저장하고(`collector/events.py`), `request_id`의 첫 `/` 앞부분(flow)이 같은 기록을 `GET /flows`로 묶는다.

## 현재 상태 (2026-11-03)

- `services/`: Gateway·Collector 동작, 테스트 80개 통과.
- 가상 집: 새 시나리오의 거실(HA helper 7개). Home Agent(`home`)는 아직 없어서 토큰 자리만 있다.
- 화면 없음.

## 다음 (계획서 8장 1주차)

1. `AgentSpec`, `ConnectionBinding`, 도구 카탈로그, `session_assistant` 템플릿, Home-A2A 메시지를 공통 JSON 예제로 합의한다.
2. 손으로 쓴 운동 명세가 Pydantic + 의미 검증을 통과하게 한다.
3. Home Agent와 공통 실행기를 붙여 손으로 쓴 명세로 시작·정지·종료를 확인한다.
