# 프로젝트 맥락 (인수인계)

새 세션이나 새 팀원이 이 프로젝트를 이어받을 때 먼저 읽는 문서. 결정이 바뀌면 여기를 고친다.

## 무엇을 만드나

**A2A based Agentic Home** — A2A 프로토콜 확장(Ambient-A2A)을 통한 사용자 정보 공유 및 분산 스마트홈 제어 시스템.
한양대 CSE406 소프트웨어공학 Phase 2 텀 프로젝트, LG전자 IC-PBL 주제 "Proactive Agentic Home". 학기 말 LG 데모.

- 세부 기획서: https://claude.ai/code/artifact/149b9ec3-d478-4a2e-8de2-2b0fb944c111
- 팀 확정 기획안: "A2A based Agentic Home" PDF (기획서와 같은 구조)

## 확정된 결정

- **예측 모델은 만들지 않는다.** 외부 기기에서 받은 현재 상태 + 공간별 정책으로 규칙 기반 자동화를 한다.
- **Agent 구성**: Desktop, Mobile (외부 기기) / My Room (P0), Baby Room·Elderly Room (P1) / Home (공용 공간).
- **분산 제어**: 각 기기는 담당 Agent가 하나. Home도 Room 기기를 직접 못 움직이고 요청만 한다. 실행 여부는 담당 Agent가 정책으로 결정한다. Device Gateway가 한 번 더 검사한다.
- **Ambient-A2A 확장 5종**: Context Sharing, Context Subscription, Room Ownership & Access Control, Policy-Aware Collaboration (여기까지 P0), Human Approval (P1).
- **구독은 A2A Task 스트리밍이 아닌 별도 확장 규약**: 제공자가 구독 목록을 관리하고, 상태가 바뀌면 구독자에게 `context.update`를 A2A 메시지로 보낸다.
- **원본 개인 데이터(일정 제목, GPS 좌표)는 Agent 밖으로 보내지 않는다.** `ambient.schemas.CONTEXT_FIELDS`의 항목만 공유한다.
- **통신**: Agent↔Agent는 A2A, Agent→Gateway는 REST, Gateway→대시보드는 WebSocket, Agent→Event Collector는 이벤트 API.
- **시연 시나리오**: A 회의 시작(조명 회의 모드 + Home에 청소기 정지 요청), B 집 전체 절전 중 Baby Room이 `SAFETY_POLICY`로 거절(P0에서는 My Room이 `OCCUPIED`로 거절), C 외출(Mobile AWAY → 방 절전, 가족 전원 AWAY → 집 전체 절전).
- 레포 구성: 모노레포 `a2a-agentic-home`.

## 사전 실험(스파이크)에서 확인한 것 — a2a-sdk 1.2.2 / A2A v1.0

- 확장 헤더: SDK가 요청의 `A2A-Extensions`를 `RequestContext.requested_extensions`로 파싱해 준다. **응답 헤더는 붙여 주지 않아** 미들웨어로 직접 구현해야 한다.
- `AgentExecutor`에서 상태 업데이트 전에 Task를 먼저 큐에 넣어야 한다 (`new_task_from_user_message`). 안 하면 `InvalidAgentResponseError`.
- metadata·DataPart 값은 protobuf Struct를 거쳐 **정수가 실수로 바뀐다** (42 → 42.0). ID·순번은 문자열로.
- `INPUT_REQUIRED` → 같은 `taskId`로 후속 메시지 → `COMPLETED` 흐름 동작 확인 (Human Approval에 사용).
- **권한 검사를 executor 안에서만 하면 우회된다.** 다른 호출자가 `SubscribeToTask`·`GetTask`·`CancelTask`로 남의 Task에 접근 가능했다. HTTP 계층 인증 + `DatabaseTaskStore`의 `owner_resolver`로 막아야 한다 (W2-2).
- v0.3 메서드 이름(`message/send`)은 `Method not found`. 인터넷 예제와 AI 생성 코드 대부분이 v0.3이니 주의 (`CLAUDE.md` 참고).
- Agent 간 왕복 지연은 로컬에서 약 20ms. 느려지는 원인은 LLM 호출뿐이므로 판단은 규칙으로 한다.
- macOS: 입력 없음 시간은 `ioreg -c IOHIDSystem`의 `HIDIdleTime`. 회의 앱 감지는 프로세스 이름 **정확 일치**로 (`zoom` 부분 일치는 `ZoomAudioDevice.driver`를 잡음). Desktop Agent는 Docker가 아닌 호스트에서 실행.

## 현재 상태

- 완료: 레포 뼈대, `ambient/` 스키마·검증기·구독 관리·A2A 변환 + 테스트, Gateway `/devices`, 설정·시나리오·contracts 초안, CI, 이슈 생성 스크립트(`scripts/create_issues.sh`, WBS 50개).
- 다음: 공간·기기 ID와 `contracts/gateway` 확정 → W0-3 설정 로더 → W2-1 Agent 서버 템플릿 → W2-2 인증·Task 소유권 → Desktop → My Room 구독 → 시나리오 A 앞부분이 끝까지 동작.
- GitHub: https://github.com/SWE26-01/a2a-agentic-home (private)
- 미정: `CODEOWNERS` 담당자, 확장 명세 문서(`docs/ambient-a2a-spec.md`) 작성.
