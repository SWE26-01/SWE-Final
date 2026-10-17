
**A2A 프로토콜 확장을 통한 사용자 정보 공유 및 분산 스마트홈 제어 시스템**


---
## 1. 프로젝트 개요

### 1.1 프로젝트 목표

기존 스마트홈의 **외부 사용자 정보 활용 부족**과 **중앙집중형 제어의 한계**를 해결하기 위해 A2A(Agent2Agent) 기반 분산 스마트홈 시스템을 제안한다.

Desktop·Mobile·Room·Home Agent가 서로 필요한 정보를 공유하고, 각 공간의 Agent가 독립적인 제어 권한과 정책을 바탕으로 기기를 관리하도록 설계한다.

이를 위해 기존 A2A 프로토콜에 스마트홈 환경에 필요한 **상태 공유, 상태 구독, 공간별 제어 권한, 정책 기반 협업 규칙**을 추가하는 Ambient-A2A 확장을 정의한다.

### 1.2 핵심 목표

1. **Cross-Device Context Sharing:** Desktop·Mobile 등 외부 기기의 사용자 상태를 스마트홈에서 활용
    
2. **Room-Level Autonomy:** 각 방의 Agent가 독립적인 제어 권한과 정책 보유
    
3. **Policy-Aware Collaboration:** 에이전트 간 요청을 공간별 정책에 따라 허용하거나 거절
    
4. **Ambient-A2A Extension:** 스마트홈 전용 상태 공유·권한 관리·협업 규약 정의
    

---

## 2. Background & Problem Definition

### 2.1 외부 기기의 사용자 정보 활용 부족

LG ThinQ와 같은 기존 스마트홈 플랫폼은 가전 제어와 자동화를 지원하지만, Desktop·Mobile 등 외부 기기가 보유한 사용자 정보를 폭넓게 활용하는 데 한계가 있다.

|기기|보유 정보|스마트홈 활용|
|---|---|---|
|Desktop|회의 일정, PC 사용 상태|회의 중 방해 최소화, 조명 모드 변경|
|Mobile|외출·귀가 상태, 사용자 설정|절전 모드, 귀가 시 환경 설정|
|Smart Home|방별 재실, 온도, 조명 상태|환경 관리 및 기기 제어|

예를 들어 Desktop에서 화상회의가 시작되면 스마트홈이 이를 전달받아 방 조명을 변경하거나 로봇청소기를 일시정지할 수 있다.

이러한 기능을 구현하려면 외부 기기와 스마트홈 간 정보 교환이 필요하다.

다만 모든 원본 데이터를 중앙 서버에 수집할 필요는 없다. 각 기기에서 필요한 상태 정보만 선택적으로 제공하도록 설계한다.

### 2.2 중앙집중형 제어의 한계

하나의 중앙 오케스트레이터가 집 안 모든 공간을 제어하는 방식은 공간별 요구사항과 안전 규칙이 다를 때 문제가 발생할 수 있다.

- **아기 방:** 수면 중 조명·온도 변경 제한
    
- **노약자 방:** 안전을 위해 특정 기기의 자동 종료 제한
    
- **개인 방:** 사용자별 설정 및 제어 권한 보호
    
- **공용 공간:** 여러 사용자의 재실 상태를 고려한 제어
    

중앙 시스템이 집 전체 기기를 직접 제어할 수 있다면 잘못된 판단이나 명령이 여러 공간에 영향을 미칠 수 있다.

따라서 각 공간의 Agent가 독립적인 제어 권한과 정책을 보유하고, 다른 Agent의 요청도 자체적으로 검증하는 구조가 필요하다.

### 2.3 해결 방향

**외부 정보 부족은 기기 Agent 간 상태 공유로, 중앙집중형 제어의 위험은 공간별 Agent의 권한 분리로 완화한다.**

이를 위해 A2A 기반 Multi-Agent Architecture를 도입한다.

---

## 3. A2A Protocol

### 3.1 A2A란?

A2A(Agent2Agent)는 서로 다른 AI Agent가 기능을 탐색하고, 메시지를 교환하며, 작업을 요청할 수 있도록 하는 개방형 통신 프로토콜이다.

각 Agent가 서로 다른 프레임워크나 실행 환경에서 동작하더라도 공통 인터페이스를 통해 협업할 수 있도록 설계되었다.

### 3.2 주요 구성요소

|구성요소|설명|
|---|---|
|Agent Card|Agent의 주소, 기능, 인증 요구사항 공개|
|Skill|Agent가 제공하는 작업 및 기능|
|Message|Agent 간 요청 및 응답|
|Task|실행 상태를 가지는 작업|
|DataPart|구조화된 JSON 데이터 전달|
|Artifact|작업 결과 데이터|
|Extension|특정 도메인에 필요한 추가 규약|

### 3.3 A2A를 선택한 이유

- **Interoperability:** 서로 다른 기기·플랫폼의 Agent 연결
    
- **Agent Discovery:** 새로운 Room Agent의 기능 탐색
    
- **Task Delegation:** 제어 권한을 가진 Agent에 작업 요청
    
- **Extensibility:** 기존 통신 구조를 유지하면서 스마트홈 전용 규약 추가
    

A2A 자체가 기기 접근 권한이나 공간별 안전 정책을 자동으로 보장하지는 않는다. 해당 기능은 Ambient-A2A 확장 규칙과 Device Gateway에서 구현한다.

---

## 4. 제안 시스템 아키텍처

### 4.1 전체 구조

시스템은 외부 기기 Agent, 공간별 Room Agent, Home Agent로 구성한다.

**External Device Agents**

- Desktop Agent: 회의 일정, PC 활동 상태 등 제공
    
- Mobile Agent: 외출·귀가 상태 제공, 사용자 승인 처리
    

**Room Agents**

- My Room Agent: 개인 방 기기 관리 및 외부 상태에 따른 자동화
    
- Baby Room Agent (확장): 아기 방 안전 정책 적용
    
- Elderly Room Agent (확장): 노약자 방 전용 제어 정책 적용
    

**Home Agent**

- 공용 공간 기기 관리
    
- 집 전체 재실 및 에너지 상태 관리
    
- 여러 Room Agent에 협업 요청
    
- 집 전체 작업의 실행 결과 취합
    

### 4.2 분산 제어 구조

각 Room Agent는 자신의 공간에 대한 제어 권한을 보유한다.

Home Agent는 집 전체 상태를 조회하거나 여러 Agent에 작업을 요청할 수 있지만, 각 Room Agent가 담당하는 기기를 임의로 직접 제어할 수 없다.

다른 공간의 기기 제어가 필요한 경우 담당 Room Agent에 A2A로 요청해야 하며, 최종 실행 여부는 해당 Agent가 결정한다.

예를 들어 Home Agent가 집 전체 절전을 요청하더라도 Baby Room Agent는 수면 환경이나 안전 규칙에 따라 에어컨 종료를 거절할 수 있다.

### 4.3 에이전트 역할

|Agent|관리 정보|주요 책임|제어 권한|
|---|---|---|---|
|Desktop|일정, PC 활동|사용자 상태 제공|없음|
|Mobile|외출·귀가, 사용자 입력|상태 제공 및 승인 처리|없음|
|My Room|방 재실·온도·외부 상태|개인 방 자동화 및 정책 적용|개인 방|
|Home|공용 공간 및 가구 재실|공용 공간 관리 및 협업 요청|공용 공간|
|Baby Room|온도·조도·수면 설정|수면·안전 정책 적용|아기 방|
|Elderly Room|재실·환경·안전 설정|안전 중심 제어|노약자 방|

### 4.4 통신 구조

|통신 대상|방식|목적|
|---|---|---|
|Agent ↔ Agent|A2A|상태 공유, 구독, 제어 요청|
|Agent → Device Gateway|REST API|기기 상태 조회 및 실제 제어|
|Device Gateway → Dashboard|WebSocket|기기 상태 변경 전달|
|Agent → Event Collector|이벤트 API|요청·응답 및 정책 판단 로그|

---

## 5. Ambient-A2A Extension 설계

### 5.1 확장 목적

기존 A2A는 Agent 간 통신과 작업 처리를 지원하지만, 스마트홈 환경에 필요한 상태 데이터 형식과 공간별 기기 소유권, 제어 정책을 정의하지 않는다.

따라서 **Ambient-A2A**라는 스마트홈 전용 확장 규약을 제안한다.

기존 A2A의 Agent Card, Message, Task 구조를 유지하면서 추가적인 데이터 스키마와 처리 규칙을 정의한다.

### 5.2 Extension 1 — Context Sharing

**목적:** Desktop·Mobile 등 외부 기기의 사용자 상태를 다른 Agent가 활용할 수 있도록 한다.

각 Agent는 원본 데이터를 그대로 제공하지 않고 필요한 상태 필드만 공개한다.

|Agent|공유 데이터|공유하지 않는 데이터|
|---|---|---|
|Desktop|회의 시작 시각, 회의 앱 상태, PC 상태|일정 제목, 화면 내용|
|Mobile|HOME/AWAY, 이동 상태|GPS 좌표, 이동 기록 원본|
|Room|재실 여부, 온도, 조도|개인 활동 기록 전체|

**상태 데이터 예시**

```
{
  "type": "context.update",
  "source": "desktop-user1",
  "subject": "user1",
  "sequence": 12,
  "expires_at": "2026-10-16T14:00:00+09:00",
  "data": {
    "meeting_app_active": true,
    "pc_state": "ACTIVE"
  }
}
```

**확장 규칙**

- `sequence`로 상태 변경 순서 관리
    
- `expires_at`으로 데이터 유효기간 제한
    
- 사용자·에이전트별 조회 가능 필드 제한
    
- 상태 변경 시 등록된 Agent에 업데이트 전달
    
- 원본 개인 데이터 전송 금지
    

**A2A 적용:** Message의 DataPart를 이용해 상태 데이터를 전달한다.

### 5.3 Extension 2 — Context Subscription

**목적:** 다른 Agent가 제공하는 상태 중 필요한 항목만 구독하고 변경 사항을 전달받는다.

예를 들어 My Room Agent는 Desktop Agent의 회의 앱 실행 여부와 PC 상태만 구독할 수 있다.

**구독 요청 예시**

```
{
  "type": "context.subscribe",
  "requester": "my-room-user1",
  "subject": "user1",
  "fields": [
    "meeting_app_active",
    "pc_state"
  ]
}
```

**처리 과정**

1. My Room이 Desktop에 구독 요청
    
2. Desktop이 호출자 인증 및 접근 권한 검사
    
3. 허용된 필드에 대한 구독 등록
    
4. 상태 변경 시 My Room에 A2A 메시지 전송
    
5. 구독 해지 또는 만료 시 전달 종료
    

A2A의 Task Streaming은 일반적인 상태 변경 구독 기능과 다르므로, Context Subscription은 별도 확장 규약으로 구현한다.

### 5.4 Extension 3 — Room Ownership & Access Control

**목적:** 각 공간의 독립적인 제어 권한과 정책을 정의한다.

각 Room Agent는 담당 공간과 제어 가능한 기기를 관리하며, 해당 기능을 Agent Card의 Skill 및 확장 정보로 공개한다.

**권한 구조**

|요청자|대상|기본 정책|
|---|---|---|
|My Room|자기 방|직접 제어|
|Home|My Room|Room Agent에 요청 필요|
|Home|Baby Room|Baby Room의 안전 정책 적용|
|My Room|Living Room|담당 Agent의 허용 필요|
|외부 Agent|공용 공간|인증·권한 검사 후 처리|

**확장 규칙**

- 각 기기는 하나의 실행 담당 Agent를 가진다.
    
- 다른 Agent는 담당 Agent에 제어를 요청한다.
    
- 담당 Agent가 최종 허용·거절을 결정한다.
    
- Device Gateway에서도 제어 권한을 검사한다.
    
- 안전 정책에 위배되는 명령은 요청자와 관계없이 거절한다.
    

화재 경보 등 별도의 안전 시스템이 담당하는 비상 상황은 일반적인 자동화 권한 체계와 분리한다.

### 5.5 Extension 4 — Policy-Aware Collaboration

**목적:** Agent가 다른 Agent의 기기 제어 요청을 공간별 정책과 현재 상태에 따라 처리하도록 한다.

**제어 요청 예시**

```
{
  "type": "device.control",
  "request_id": "req-001",
  "requester": "home-agent",
  "target": "baby-room-agent",
  "action": {
    "device": "baby_room_ac",
    "command": "TURN_OFF"
  },
  "reason_code": "ENERGY_SAVING"
}
```

Baby Room Agent는 자신의 정책을 검사하고 실행 여부를 결정한다.

**거절 응답 예시**

```
{
  "request_id": "req-001",
  "accepted": false,
  "reason_code": "SAFETY_POLICY",
  "message": "Temperature regulation must remain enabled."
}
```

**정책 판단 요소**

- 사용자 및 공간의 재실 상태
    
- 기기의 현재 상태
    
- 공간별 안전 규칙
    
- 요청자의 제어 권한
    
- 사용자 승인 필요 여부
    

제어 요청이 거절되면 이유를 반환하고, 요청과 결과를 감사 로그에 기록한다.

### 5.6 Extension 5 — Human Approval

**목적:** 집 전체 절전처럼 영향 범위가 큰 동작에 사용자 승인을 요구한다.

**처리 방식**

1. Agent가 실행할 명령과 대상 기기 목록 확정
    
2. 승인 대상 명령의 해시 생성
    
3. Mobile Agent에 승인 요청 전달
    
4. 사용자 승인 후 일회용 승인 토큰 발급
    
5. 실행 시 토큰, 명령 해시, 유효기간 검증
    

승인된 명령과 실제 실행할 명령이 다르면 요청을 거절한다.

---

## 6. Agent Discovery 및 동적 확장

### 6.1 Agent Card 확장

각 Agent의 Agent Card에 Ambient-A2A 확장 지원 여부를 선언한다.

**추가 정보**

- 담당 공간 및 공간 유형
    
- 제공 가능한 상태 데이터 필드
    
- 지원하는 기기 제어 Skill
    
- Ambient-A2A 확장 버전
    
- 인증 및 접근 권한 요구사항
    

표준 Agent Card 구조를 유지하고, 추가 정보는 A2A Extension의 `params` 또는 확장 전용 데이터에 포함한다.

### 6.2 신규 Room Agent 추가

새로운 방을 시스템에 연결하는 과정은 다음과 같다.

1. Room Agent 실행 및 Agent Card 등록
    
2. Agent Card를 통한 제공 기능 확인
    
3. 담당 공간과 기기 소유권 설정
    
4. 필요한 외부 상태 데이터 구독
    
5. 자체 공간 정책 적용
    
6. 다른 Agent로부터 제어 요청 수신
    

이 구조를 통해 기존 Home Agent의 내부 구현을 크게 변경하지 않고도 새로운 Room Agent를 추가할 수 있도록 한다.

### 6.3 Agent 간 직접 협업

모든 요청이 Home Agent를 반드시 거칠 필요는 없다.

예를 들어 My Room Agent가 거실의 TV 상태를 확인해야 하는 경우 Living Room Agent에 직접 A2A 요청을 보낼 수 있다.

단, 상대 Agent의 권한과 정보 공개 정책을 준수해야 한다.

---

## 7. 상태 기반 자동화 및 분산 의사결정

### 7.1 상태 기반 자동화

본 프로젝트는 사용자 행동을 별도 ML 모델로 예측하기보다, **외부 기기에서 전달된 현재 상태와 공간별 정책을 조합하여 자동화 동작을 수행**한다.

|입력 상태|담당 Agent|자동화 동작|
|---|---|---|
|회의 앱 실행|My Room|조명 회의 모드|
|PC 종료, 방 비어 있음|My Room|조명 및 에어컨 절전|
|Mobile AWAY|My Room|개인 방 절전|
|가족 전원 AWAY|Home|집 전체 절전 요청|
|아기 수면 상태 활성화|Baby Room|조명·온도 변경 제한|
|노약자 안전 기기 작동 중|Elderly Room|자동 종료 요청 거절|

자동화 규칙은 각 Agent가 독립적으로 관리한다.

### 7.2 분산 의사결정

전체 의사결정을 Home Agent에 집중시키지 않는다.

- **External Agent:** 자신이 보유한 상태 정보를 제공
    
- **Room Agent:** 공간별 자동화 및 안전 정책 판단
    
- **Home Agent:** 공용 공간 관리와 집 전체 작업 조정
    
- **Device Gateway:** 실제 기기 제어 권한 검증 및 실행
    

다른 Agent가 작업을 요청하더라도 실행 담당 Agent가 자체 정책을 검사한 뒤 최종 실행 여부를 결정한다.

### 7.3 정책 충돌 처리

집 전체 절전 요청과 특정 방의 안전 정책이 충돌할 수 있다.

예를 들어 Home Agent가 모든 에어컨 종료를 요청했을 때 다음과 같이 처리한다.

1. Home Agent가 각 Room Agent에 절전 요청 전달
    
2. 각 Room Agent가 자체 정책과 기기 상태 확인
    
3. 허용 가능한 기기만 절전 실행
    
4. 안전 정책과 충돌하는 기기는 실행 거절
    
5. Home Agent가 방별 실행 결과를 취합
    

따라서 집 전체 작업도 각 공간의 제어 권한을 침해하지 않고 수행할 수 있다.

---

## 8. 구현 범위 및 기술 스택

### 8.1 구현 범위

|우선순위|기능|
|---|---|
|P0|Desktop·Mobile·My Room·Home Agent|
|P0|A2A 통신 및 Agent Card|
|P0|Context Sharing 및 Subscription|
|P0|Room Ownership 및 Access Control|
|P0|Policy-Aware Collaboration|
|P0|상태 기반 자동화 규칙|
|P0|Virtual Device Gateway|
|P0|가상 스마트홈 상태 관리|
|P0|A2A 통신 및 제어 결과 로그|
|P1|Human Approval|
|P1|Baby·Elderly Room Agent|
|P1|동적 Agent 등록|
|P1|Room Agent 간 직접 협업|

### 8.2 기술 스택

|영역|기술|
|---|---|
|Agent Communication|A2A Protocol v1.0, Python a2a-sdk|
|Backend|Python 3.11+, FastAPI, Pydantic v2|
|Storage|SQLite|
|Automation|Rule-based Policy Engine|
|Frontend|React, TypeScript|
|Monitoring|WebSocket|
|Testing|pytest|
|Device Control|Virtual Device Gateway REST API|

### 8.3 검증 항목

- 외부 Agent의 상태 데이터가 올바르게 전달되는가?
    
- 허용되지 않은 사용자 상태 조회가 차단되는가?
    
- 오래되거나 만료된 상태 데이터가 무시되는가?
    
- 각 Room Agent가 자신의 기기만 직접 제어하는가?
    
- 안전 정책에 위배되는 제어 요청이 거절되는가?
    
- Home Agent 중단 시 Room Agent가 독립적으로 동작하는가?
    
- 여러 Room Agent가 집 전체 작업을 협력하여 처리할 수 있는가?
    
- 새로운 Room Agent를 기존 구조에 연결할 수 있는가?
    

---

## 9. 기대 효과 및 차별점

|기존 시스템의 한계|제안 시스템|
|---|---|
|스마트홈 내부 정보 중심|Desktop·Mobile의 상태 정보까지 활용|
|중앙 오케스트레이터 중심|Room Agent 기반 분산 제어|
|모든 공간에 공통 제어 정책|공간별 독립적인 안전 정책|
|플랫폼별 개별 연동|A2A 기반 기능 탐색 및 협업|
|특정 기기 중심의 자동화|여러 Agent의 상태를 활용한 자동화|
|중앙 판단 오류의 영향 확대 가능성|제어 권한 분리를 통한 영향 범위 제한|

### 핵심 기여

**1. Cross-Device Context Integration**

스마트홈 외부의 Desktop·Mobile Agent가 제공하는 상태 정보를 필요한 범위에서 공유한다.

**2. Room-Level Autonomy**

각 방에 독립적인 Agent를 배치하고, 기기 제어 권한과 공간별 정책을 분리한다.

**3. Ambient-A2A Extension**

기존 A2A에 스마트홈 환경에 필요한 상태 공유, 상태 구독, 기기 소유권, 정책 기반 제어 협업 규칙을 추가한다.

### 최종 목표

**A2A 기반 에이전트 협업을 통해 외부 기기의 사용자 정보를 스마트홈에 활용하면서도, 각 공간이 독립적인 제어 권한과 정책을 유지하는 분산 스마트홈 시스템을 구현한다.**

중앙 오케스트레이터가 모든 기기를 직접 제어하는 방식에서 벗어나, 각 Agent가 자신의 책임 범위에서 상태를 관리하고 다른 Agent와 협력하는 스마트홈 아키텍처를 제안한다.