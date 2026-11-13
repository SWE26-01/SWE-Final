# 프로젝트 맥락 (인수인계)

새 세션이나 새 팀원이 이 프로젝트를 이어받을 때 먼저 읽는 문서. 결정이 바뀌면 여기를 고친다.

## 무엇을 만드나

**Extension of SmartHome: Internal & External Connectivity via A2A.** 사용자가 자연어로 에이전트를 만들고,
찾고, 연결해 A2A로 분산 협업하게 하는 플랫폼. 제안서는 [PROPOSAL.md](PROPOSAL.md)이고, 이 문서보다 우선한다.
한양대 CSE406 소프트웨어공학 텀 프로젝트(LG전자 IC-PBL)이고, 학기 말에 데모를 한다.

- **Agent Studio**: 자연어 요구 → 에이전트 생성. LangChain으로 요구를 구조화하고 플랫폼이 제공하는 Skill을 조합
- **Agent Hub**: 생성된 에이전트 등록, A2A Agent Card로 기능·인터페이스 확인, 검색·연결
- **분산 협업**: 각 에이전트가 자기 실행 환경과 권한을 가진 채 A2A로 작업을 요청·위임. 중앙 오케스트레이터에 권한을 모으지 않는다
- 시나리오: 기본(생성 → Hub 등록 → 검색·연결 → A2A 협업), 확장(스마트 병원: 진료과·병실 에이전트가 센서·외부 시스템과 연결)

## 피봇 기록

1. ~2026-10: A2A based Agentic Home. OpenClaw 에이전트 5개가 Ambient-A2A 확장으로 상태를 공유하고 방별로 기기를 나눠 제어.
2. 2026-11-02~03 (브랜치 `hub-studio`): 스마트홈 전용 Agent Hub & Studio(운동 코치 에이전트, `session_assistant` 템플릿,
   기기는 Home Agent 하나만 제어). OpenClaw 에이전트·TS 플러그인(`agents/`), Ambient-A2A 명세(`spec/`), Runner, a2a-sdk 실험,
   EXAONE 학습 실험(`training/`), 시뮬레이터 화면(`frontend/`)을 지웠다. 모두 커밋 `216840e`에 있다.
3. 2026-11-12: 지금 제안서로 바꿨다. 운동 코치 MVP 계획서(`AGENT_HUB_STUDIO_DEV_PLAN.md`, 커밋 `d81927c`에 있음)와
   "Home Agent만 기기를 제어한다" 규칙을 지웠다. 2026-11-13: 기획서에서 Skill Marketplace를 뺐다(Skill은 플랫폼이 제공하는 목록만 쓴다).

예전 코드 꺼내기: `git show 216840e:agents/ambient-a2a-plugin/src/a2a.ts`(OpenClaw A2A 플러그인),
`git show 216840e:services/spikes/02_subscription_scope_chain.py`(a2a-sdk 1.2.2 서버·클라이언트 예제),
`git show 216840e:frontend/src/Home3D.jsx`(3D 집 화면).

## 남긴 것과 이유

- **가상 기기(Home Assistant) + Device Gateway**: 에이전트가 연결할 "센서·기기". Gateway가 기기마다 주인 에이전트를 확인하므로
  "에이전트별 독립 권한"을 그대로 보여 준다. 스마트 병원 시나리오도 helper만 바꾸면 같은 구조로 된다.
- **Event Collector**: 에이전트 사이 A2A 통신을 한곳에 모으고 요청 ID로 흐름을 묶는다. 분산 협업을 데모에서 보여 줄 때 쓴다.
  Agent Card를 주기적으로 읽어 에이전트가 살아 있는지도 본다(Hub 탐색에 재사용 가능).
- `services/`의 공통 기반: pyproject, CI(ruff, pytest, contracts 검사), Dockerfile, 토큰 인증(`common/auth.py`).

## 확정된 원칙

- A2A는 v1.0만 쓴다(규칙은 `CLAUDE.md`).
- 인증·권한·연결 승인은 코드가 한다. 프롬프트에 맡기지 않는다.
- Agent Card는 검증된 에이전트 정의와 실행 주소에서 결정적으로 만든다. 코드도 권한 증명서도 아니다.
- 공유되는 에이전트 정의·Skill과 배포별 연결 정보·자격 증명은 분리한다. 토큰은 정의·Agent Card·로그에 넣지 않는다.
- 에이전트는 자기가 주인인 기기만 Device Gateway로 제어한다. 남의 기기는 그 주인 에이전트에게 A2A로 부탁한다.
- 화면(Studio·Hub)은 React + TypeScript로 새로 만든다.

## 확정된 결정

- **에이전트 실행기는 Python이고, 채팅 응답만 OpenClaw가 한다(2026-11-12).** 생성된 에이전트는 Python 실행기(a2a-sdk)가
  띄운다. A2A 서버, Agent Card, Skill 실행, 권한 검사, 기기 호출, 타이머는 Python 코드가 맡는다. OpenClaw는 에이전트가 사용자와
  채팅으로 대화하는 부분에만 쓴다. 이유: 에이전트마다 OpenClaw(Node 프로세스 약 1.2GB)를 띄우면 무겁고, 세션·권한 로직을 TS 플러그인으로
  써야 한다. 반면 채팅 응답의 품질은 OpenClaw가 낫다.
  예전 OpenClaw 설정과 플러그인은 `216840e`의 `agents/`에 있다(Ambient-A2A용이라 A2A v1.0에 맞는지 확인해야 한다).

## 다시 정할 것

- **Python 실행기와 OpenClaw의 경계.** 사용자 채팅을 OpenClaw가 직접 받고 필요한 작업을 실행기에 넘길지, 실행기가 받아서 대화 턴만
  OpenClaw에 넘길지 정한다. OpenClaw 인스턴스를 에이전트마다 둘지, 하나를 여러 에이전트가 같이 쓸지도 정한다. 권한 검사는 어느 쪽이든 Python 쪽에 둔다.
- **Skill의 형식과 기본 목록.** 프로젝트 자체 정의(이름·설명·입출력·필요 권한)로 둘지 정하고, Studio가 조합할 기본 Skill 목록을 정한다.
  Marketplace가 없으므로 Skill은 플랫폼이 코드로 제공하는 것만 쓴다.
- **에이전트 정의 형식**(Studio 출력)과 Hub 레코드(정의, 실행 주소, 연결·승인 권한). 코드보다 공통 JSON 예제로 먼저 합의한다.
- 생성 모델(LangChain 뒤의 모델)과 고정할 버전.
- Hub 인증과 연결 해제 시 토큰 무효화. 지금 Gateway·Collector의 호출자는 `services/config/agents.yaml` 고정 목록이라,
  생성된 에이전트를 받으려면 Hub가 발급한 토큰을 받아들이게 바꿔야 한다.
- 데모 시나리오의 가상 기기: 지금은 거실 하나(재실, 온도, 조명·밝기, 에어컨·희망 온도, TV)이고 주인은 `home` 하나다.
  스마트 병원으로 가면 병실 helper와 주인을 새로 정한다.

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
  에이전트가 상태 변화를 받으려면 이 스트림을 에이전트에게도 열어야 한다(지금은 대시보드 토큰만).
- 테스트는 가짜 HA(`httpx.MockTransport`, 가짜 WebSocket)와 자체 설정(`services/tests/config`: 기기 주인 `home`과 기기 없는 `coach`)으로 돈다.
  실제 설정은 `test_homeconfig.py`가 확인하고, HA 설정의 helper와 `devices.yaml`이 같은지도 본다.
- Collector는 정해진 필드만 저장하고(`collector/events.py`), `request_id`의 첫 `/` 앞부분(flow)이 같은 기록을 `GET /flows`로 묶는다.
  이벤트 형식은 에이전트 간 메시지를 정할 때 같이 고친다.
- 환경 변수 접두어 `AMBIENT_`는 첫 번째 프로젝트에서 온 이름이다. 기능에는 영향이 없어서 그대로 뒀다.

## 현재 상태 (2026-11-12)

- `services/`: Gateway·Collector 동작, 테스트 통과. Studio·Hub·에이전트 실행기는 아직 없다.
- 가상 집: 거실 helper 7개, 주인 `home`(토큰 자리만 있고 에이전트는 없음).
- 화면 없음.

## 다음

1. Python 실행기와 OpenClaw의 경계, Skill 형식과 기본 목록을 정한다.
2. 에이전트 정의, Skill, Hub 레코드를 공통 JSON 예제로 합의하고, 이를 바탕으로 개발 계획서를 새로 쓴다.
3. 손으로 쓴 에이전트 두 개를 Hub에 등록하고 Agent Card로 서로 찾아 A2A로 작업을 주고받게 한다(Studio 없이).
