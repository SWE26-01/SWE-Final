# Ambient-A2A Extension v1

URI: `https://github.com/nsu102/A2A-agents/spec/ambient-a2a/v1`

이 문서는 A2A v1.0 위에 스마트홈용 상태 공유, 구독, 소유권, 정책 협업 규약을 정의하는 확장 스펙이다. A2A 표준 구조(Agent Card, `SendMessage`, Task, DataPart)는 바꾸지 않고, 추가 정보는 확장 `params`와 DataPart 스키마로만 정의한다.

## 1. Agent Card 선언

```json
"capabilities": {
  "extensions": [{
    "uri": "https://github.com/nsu102/A2A-agents/spec/ambient-a2a/v1",
    "required": true,
    "params": {
      "role": "external | home | room",
      "space": "my_room",
      "owned_devices": ["input_boolean.room1_light"],
      "provided_fields": ["meeting_app_active"],
      "energy_saving": [{ "device": "input_boolean.room1_light", "command": "TURN_OFF" }]
    }
  }]
}
```

- Card는 `<base>/.well-known/agent-card.json`에서 제공하고, JSON-RPC 엔드포인트는 `<base>/a2a/v1`이다. 이 구현의 `<base>`는 `http://host:port/plugins/ambient`다.
- Home Agent는 room Card의 `owned_devices`로 기기 소유권 맵을 구성한다(Agent Discovery).

## 2. 전송

- 모든 메시지는 `SendMessage`이며, `message.parts[]`에 DataPart(`{"data": {...}}`)를 하나 담는다. 판별자는 `data.type`이다.
- 헤더:
  - `Authorization: Bearer <발신 에이전트 토큰>`: 수신자는 토큰으로 발신자를 식별한다. payload의 `requester` 또는 `source`가 토큰 신원과 다르면 `UNAUTHORIZED`로 거절한다.
  - `A2A-Extensions: <URI>`
- 응답은 동기 Task 하나다. `artifacts[0].parts[0].data`에 결과가 담기고, `status.state`는 다음과 같다:
  - `TASK_STATE_COMPLETED`: 수락, 또는 일부만 수행된 `PARTIAL`
  - `TASK_STATE_REJECTED`: 거절

## 3. 메시지

| type | 방향 | 요청 필드 | 결과 필드 |
|---|---|---|---|
| `context.subscribe` | room/home → external | `requester, subject, fields[]` | `granted_fields, denied_fields, reason_code` |
| `context.unsubscribe` | room/home → external | `requester` | |
| `context.query` | room/home → external | `requester, subject, fields[]` | `values{}, granted, denied, sequence, expires_at` (만료된 값은 `null`) |
| `context.update` | external → 구독자 | `source, subject, sequence, expires_at, data{}` | `accepted, reason_code` |
| `device.control` | any → home/room | `request_id, requester, target, action{device?, command, value?}, reason_code?, on_behalf_of?` | `request_id, accepted, reason_code, message, results[]?, delegated_to?` |

`command`는 `TURN_ON`, `TURN_OFF`, `SET`(`value`: 옵션 또는 숫자), `ENERGY_SAVING` 중 하나다. `ENERGY_SAVING`에는 `device`가 없으며, 각 방이 자기 `energy_saving` 목록을 직접 해석해 실행한다.

## 4. 처리 규칙

1. **Context Sharing**
   - 발신자는 `provided_fields`만 공개하고, 그중에서도 요청자별 ACL을 통과한 필드만 보낸다. 원본 데이터(일정 제목, GPS 등)는 전송하지 않는다.
   - 수신자는 소스별 `sequence`가 이전보다 크지 않거나 `expires_at`이 지난 업데이트를 `STALE`로 거절한다.
2. **Subscription**: 허용된 필드만 등록한다. 상태가 바뀌면 구독자마다 `granted ∩ changed` 필드만 담은 `context.update`를 보낸다.
3. **Ownership**: 기기마다 실행 담당 Agent가 하나다.
   - 소유하지 않은 기기를 제어하라는 요청은 `NOT_OWNER`로 거절한다.
   - 단, Home은 소유 Agent에게 위임(`delegated_to`)하고, 결과는 소유 Agent가 결정한다.
4. **Policy-Aware Collaboration**: `device.control`은 아래 순서로 처리한다.
   1. 요청자 ACL을 확인한다. 실패하면 `UNAUTHORIZED`이고 위임하지 않는다.
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
| `EXECUTION_FAILED` | 기기 실행 실패 |
| `BAD_REQUEST` | 알 수 없는 type이거나 필수 필드 누락 |
