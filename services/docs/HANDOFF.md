# 프로젝트 맥락 (인수인계)

새 세션이나 새 팀원이 이 프로젝트를 이어받을 때 먼저 읽는 문서. 결정이 바뀌면 여기를 고친다.

## 무엇을 만드나

**A2A based Agentic Home**: A2A 프로토콜 확장(Ambient-A2A)을 통한 사용자 정보 공유 및 분산 스마트홈 제어 시스템.
한양대 CSE406 소프트웨어공학 Phase 2 텀 프로젝트이고, 주제는 LG전자 IC-PBL "Proactive Agentic Home"이다. 학기 말에 LG 데모를 한다.

- 팀 기획서: A2A-agents 레포의 `plan.md`와 같다. 세부 기획서: https://claude.ai/code/artifact/149b9ec3-d478-4a2e-8de2-2b0fb944c111

## 레포 역할 (2026-10-18 정리)

| 레포 | 담당 | 내용 |
| --- | --- | --- |
| SWE26-01/A2A-agents | nsu102 | 에이전트 5개를 모두 OpenClaw로 구현한다: desktop, smartphone, orchestrator(=Home), room1(=My Room), room2(수면 정책 방). TS 플러그인 하나(`ambient-a2a`)에 확장 규칙이 들어 있고, Ambient-A2A 명세는 `spec/ambient-a2a.md`, Home Assistant 가상 기기와 기본 Lovelace도 이 레포에 있다 |
| SWE26-01/SWE-frontend | lahee3423 | React 2D 평면도 시뮬레이터. 아직 전부 가짜 데이터다 |
| **SWE26-01/a2a-agentic-home** (이 레포) | | Device Gateway(HA 앞 주인 검사), Event Collector(통신 기록 모음), 연동 확인 |

처음에는 이 레포에 Python(a2a-sdk) 에이전트를 만들고 있었다. 그런데 A2A-agents가 같은 시스템을 OpenClaw로 먼저 끝까지 구현해서,
에이전트는 그쪽으로 일원화했다. 이 레포는 A2A-agents에 없는 두 가지만 맡는다.
- HA에는 기기별 권한이 없어서, 지금은 에이전트 코드의 자체 검사가 유일한 방어선이다. Gateway가 이와 독립된 두 번째 검사를 한다.
- 지금은 에이전트마다 파일에 기록해서, 대시보드에 A2A 로그·판단 결과 화면이 없다. Collector가 이 기록을 한곳에 모은다.

## 확정된 결정

- **예측 모델은 만들지 않는다.** 외부 기기의 현재 상태와 공간별 정책으로 판단한다.
- **분산 제어**: 각 기기는 담당 에이전트가 하나다. Home도 방 기기는 주인 에이전트에게 넘기기만 한다(`on_behalf_of`). Gateway가 한 번 더 검사한다.
- **원본 개인 데이터(일정 제목, GPS)는 에이전트 밖으로 보내지 않는다.** Collector는 정해진 필드만 저장하고, Gateway는 `devices.yaml`에 있는 엔티티만 보여 준다.
- **HA 토큰은 Gateway만 가진다**(목표). 에이전트는 자기 에이전트 토큰으로 Gateway를 부른다. A2A-agents 쪽 변경은 `docs/integration.md`에 정리돼 있고, 담당자 합의가 필요하다.
- **기록은 에이전트가 Collector로 보낸다**(파일 읽기 아님). 토큰으로 보낸 에이전트를 확인하고, PC가 달라도 동작한다.
- **ID는 A2A-agents를 따른다**: 에이전트 ID, 기기 ID(HA 엔티티 ID), 거절 사유 코드(`OK`, `NOT_OWNER`, `SAFETY_POLICY`, `PARTIAL` …).

## 팀에서 아직 정할 것

- **LLM**: 처음 의도는 "에이전트마다 로컬 LLM이 판단하고 규칙이 막는다"였다. 지금 A2A-agents는 OpenRouter(클라우드)를 쓰고, LLM은
  사람 말을 해석해 도구만 부른다. 수락·거절은 코드가 결정한다.
- **대시보드**: Lovelace 커스텀으로 갈지, SWE-frontend(React)로 갈지, 둘을 어떻게 나눌지. 어느 쪽이든 데이터는 Gateway·Collector WebSocket으로 받는다.
- **SWE-frontend**: 예측(%) 문구를 빼고, 에이전트·방 구성을 A2A-agents에 맞춘다.
- **사용자 승인(Human Approval, P1)**: A2A-agents에 아직 없다.
- **시연 시나리오**: A2A-agents `scripts/scenario.sh`가 기준이다. 회의 시작 → Home → 내 방 위임 흐름은 이미 구현돼 있다.

## 이 레포의 구현 메모

- Gateway는 HA REST API와 같은 경로를 받는다(`GET /api/states/<entity>`, `POST /api/services/<domain>/<service>`).
  그래서 A2A-agents의 `ha.ts`는 고치지 않고 주소와 토큰만 바꾸면 된다. 허용하는 서비스는 `input_boolean` on/off/toggle,
  `input_select.select_option`, `input_number.set_value`뿐이다. `entity_id`의 쉼표 목록과 `all`도 하나씩 검사한다.
- Gateway는 HA WebSocket(`state_changed`)을 구독한다. 다시 연결되면 전체 상태를 다시 읽어 대시보드에 `snapshot`을 다시 보낸다.
- 테스트는 가짜 HA(`httpx.MockTransport`, 가짜 WebSocket)로 돌아서 CI에 HA가 필요 없다.
  실제 프로세스 확인은 가짜 HA 서버를 띄워 직접 해 봤다(2026-10-18). 실제 HA와 A2A-agents를 붙인 확인은 아직이다.
- 서비스 설정은 A2A-agents `.env`를 그대로 읽는다(`--env-file`). 여기에 `DASHBOARD_TOKEN`만 추가하면 된다.

## 사전 실험에서 확인한 것 (A2A v1.0, a2a-sdk 1.2.2)

에이전트를 이 레포에서 만들던 때의 기록이다. A2A-agents와 상호 운용할 때 참고한다.
- v0.3 메서드 이름(`message/send`)은 v1.0 서버에서 `Method not found`. 인터넷 예제와 AI 생성 코드 대부분이 v0.3이다.
- metadata·DataPart 값은 protobuf Struct를 거치면서 정수가 실수가 된다(42 → 42.0).
- 권한 검사를 에이전트 로직 안에서만 하면 Task 조회·취소로 우회될 수 있다. HTTP 계층에서 토큰으로 막아야 한다.
- 에이전트 사이 왕복 지연은 로컬에서 약 20ms이고, 느려지는 원인은 LLM 호출뿐이다.

## 현재 상태

- 완료: Gateway(HA 프록시·상태 스트림), Event Collector(A2A-agents 로그 형식), 설정 로더, 연동 확인 스크립트, CI.
- 다음: A2A-agents 담당자와 `docs/integration.md` 합의 → 실제 HA·에이전트로 `verify_integration.py` 통과 → 대시보드 연결.
- GitHub: https://github.com/SWE26-01/a2a-agentic-home (private)
