# Home A2A 메시지 v1

이 문서는 A2A v1.0 위에서 스마트홈 에이전트끼리 상태를 공유·구독하고, 기기 소유권과 공간 정책에 따라 협업하는 규약이다.
A2A 표준 구조(Agent Card, `SendMessage`, Task, DataPart)는 그대로 쓰고, 이 문서는 두 가지만 정한다.
- Agent Card의 표준 `skills[].tags`에 무엇을 적는가(1절)
- DataPart에 담는 메시지와 처리 규칙(3~5절)

A2A 확장(`capabilities.extensions`, `A2A-Extensions` 헤더)은 쓰지 않는다. 처음에는 확장으로 선언했지만 2026-11-20에 뺐다.
그래서 표준 A2A 클라이언트(예: Python `a2a-sdk`)가 카드를 그대로 읽는다.

## 1. Agent Card

- 카드는 `<base>/.well-known/agent-card.json`에서 제공하고, JSON-RPC 엔드포인트는 `<base>/a2a/v1`이다
  (`supportedInterfaces[]`의 `protocolBinding: "JSONRPC"`, `protocolVersion: "1.0"`). 이 구현의 `<base>`는 `http://host:port/plugins/a2a`다.
- 역할, 공간, 소유 기기, 공개 필드는 표준 `skills[].tags`로 알린다.

| 태그 | 뜻 | 예 |
|---|---|---|
| `home` \| `room` \| `external` | 역할 | `room` |
| `space:<공간>` | 맡은 공간 | `space:my_room` |
| `device:<entity id>` | 소유 기기 | `device:input_boolean.room1_light` |
| `field:<이름>` | 공개하는 상태 필드 | `field:meeting_app_active` |
| `request:<entity id>` | 주인에게 제어를 부탁할 기기 (Studio의 루틴 에이전트) | `request:input_boolean.kitchen_coffee_machine` |

```json
"skills": [{
  "id": "device.control",
  "name": "Room device control",
  "description": "Policy-checked control of the devices this agent owns in my_room",
  "tags": ["room", "space:my_room", "device:input_boolean.room1_light", "device:input_select.room1_light_mode",
           "device:input_boolean.room1_ac", "device:input_boolean.room1_occupied"],
  "inputModes": ["application/json"],
  "outputModes": ["application/json"]
}]
```

- 역할별 skill: external은 `context.subscribe`·`context.query`, room은 `device.control`, home은 `device.control`·`home.energy_saving`.
- 카드는 권한이 아니다. 무엇을 요청하고 읽을 수 있는지는 받는 에이전트의 ACL이 정하고, Hub에서 연결한 에이전트라면
  사람이 연결할 때 승인한 권한이 더해진다(4절).
- Home은 room 카드의 `device:` 태그로 기기 소유권 표를 만든다(Agent Discovery). Hub가 켜져 있으면 Hub가 아는
  지금 주인(`GET /ownership`)을 따른다.

## 2. 전송

- 메서드는 `SendMessage`만 쓴다. `message.parts[]`에 DataPart(`{"data": {...}}`)를 하나 담고, 판별자는 `data.type`이다.
- 헤더 `Authorization: Bearer <발신 에이전트 토큰>`: 수신자는 토큰으로 발신자를 식별한다. 기본 에이전트의 토큰은
  `agents/shared.json5`에 있고, Hub에서 연결한 에이전트의 토큰은 Hub(`POST /tokens/verify`)로 확인한다.
  payload의 `requester` 또는 `source`가 토큰 신원과 다르면 `UNAUTHORIZED`로 거절한다.
- 응답은 동기 Task 하나다. `artifacts[0].parts[0].data`에 결과가 담기고, `status.state`는 다음과 같다.
  - `TASK_STATE_COMPLETED`: 수락, 또는 일부만 수행된 `PARTIAL`
  - `TASK_STATE_REJECTED`: 거절
- Task는 저장하지 않는다. `GetTask`는 항상 `-32004`(task not found)이고, 그 밖의 메서드는 `-32601`,
  DataPart가 없는 요청은 `-32602`다.

## 3. 메시지

| type | 방향 | 요청 필드 | 결과 필드 |
|---|---|---|---|
| `context.subscribe` | room/home → external | `requester, subject, fields[]` | `granted_fields, denied_fields, reason_code` |
| `context.unsubscribe` | room/home → external | `requester` | |
| `context.query` | room/home → external | `requester, subject, fields[]` | `values{}, granted, denied, sequence, expires_at` (만료된 값은 `null`) |
| `context.update` | external → 구독자 | `source, subject, sequence, expires_at, data{}` | `accepted, reason_code` |
| `device.control` | any → home/room | `request_id, requester, target, action{device?, command, value?}, reason_code?, on_behalf_of?` | `request_id, accepted, reason_code, message, results[]?, delegated_to?` |

`command`는 `TURN_ON`, `TURN_OFF`, `SET`(`value`: 옵션 또는 숫자), `ENERGY_SAVING` 중 하나다. `ENERGY_SAVING`에는 `device`가 없으며, 각 방이 자기 설정의 절전 목록(`energySaving`)을 직접 해석해 실행한다.

`request_id`는 요청 하나를 끝까지 따라간다. Home이 위임할 때는 같은 값을 쓰고, `ENERGY_SAVING`을 여러 방에 나눌 때는 `<request_id>/<room>`을 쓴다. 자동화 규칙이 시작한 동작은 규칙마다 새 `request_id`를 받는다. 그래서 `/` 앞부분이 같은 기록이 한 요청의 전체 흐름이다.

## 4. 처리 규칙

1. **Context Sharing**
   - 발신자는 공개 필드(설정의 `provides`, 카드의 `field:` 태그)만 공개하고, 그중에서도 요청자별 ACL(`fieldAcl`, Hub에서 연결한 에이전트는 사람이 승인한 읽기 권한)을 통과한 필드만 보낸다. 원본 데이터(일정 제목, GPS 등)는 전송하지 않는다.
   - 수신자는 소스별 `sequence`가 이전보다 크지 않거나 `expires_at`이 지난 업데이트를 `STALE`로 거절한다.
2. **Subscription**: 허용된 필드만 등록한다. 상태가 바뀌면 구독자마다 `granted ∩ changed` 필드만 담은 `context.update`를 보낸다.
3. **Ownership**: 기기마다 실행 담당 Agent가 하나다.
   - 소유하지 않은 기기를 제어하라는 요청은 `NOT_OWNER`로 거절한다.
   - 단, Home은 소유 Agent에게 위임(`delegated_to`)하고, 결과는 소유 Agent가 결정한다. Hub가 그 기기에 연결된 주인이 없다고 하면 Home도 `NOT_OWNER`로 거절한다.
   - Device Gateway도 같은 소유권으로 기기 명령을 한 번 더 확인한다(남의 기기 명령은 HTTP 403).
4. **Policy-Aware Collaboration**: `device.control`은 아래 순서로 처리한다.
   1. 요청자 ACL을 확인한다. ACL은 에이전트 설정의 `requestAcl`에, Hub에서 연결한 에이전트라면 사람이 승인한 `request:<entity>` 권한을 더한 것이다. 실패하면 `UNAUTHORIZED`이고 위임하지 않는다.
   2. 담당 Agent를 판단한다(직접 실행 또는 위임).
   3. 공간 정책을 확인한다. 실패하면 `SAFETY_POLICY`다. 정책은 요청자와 관계없이 적용된다.
   4. 실행한다.

## 5. reason_code

| code | 의미 |
|---|---|
| `OK` | 수락 및 실행 완료 |
| `PARTIAL` | 복수 동작 중 일부만 실행됨 (`results[]` 참조) |
| `UNAUTHORIZED` | 토큰 불일치, 신원 위조, 또는 요청자 ACL 위반 |
| `FIELD_NOT_ALLOWED` | 요청한 필드 일부가 공개 대상이 아님 (`denied` 참조) |
| `STALE` | sequence 역행 또는 만료 |
| `NOT_OWNER` | 담당 기기가 아님 |
| `SAFETY_POLICY` | 공간 안전 정책 위반 |
| `PEER_UNREACHABLE` | 상대 Agent에 연결할 수 없음 |
| `UNKNOWN_PEER` | 보낼 상대의 주소를 모름 (설정의 `peers`에도, Hub에도 없음) |
| `EXECUTION_FAILED` | 기기 실행 실패 |
| `BAD_REQUEST` | 알 수 없는 type이거나 필수 필드 누락 |
