# LAHEE HOME

React 기반 스마트홈 프론트엔드 시뮬레이터.

## 실행

```bash
npm install
npm run dev
```

Home Assistant 상태를 실시간으로 반영하려면 Device Gateway와 Home Assistant를 먼저 실행하고,
`.env.example`을 `.env.local`로 복사한 뒤 루트 `.env`의 `DASHBOARD_TOKEN` 값을
`VITE_DASHBOARD_TOKEN`에 넣는다.

```bash
cp .env.example .env.local
npm run dev
```

프론트엔드는 Home Assistant에 직접 연결하지 않고 Device Gateway의 읽기 전용 WebSocket
(`ws://127.0.0.1:8100/ws`)을 구독한다. `snapshot`으로 초기 상태를 받고
`device.state_changed` 이벤트로 화면을 갱신한다. `services/config/devices.yaml`에 등록된 새
엔티티는 `living_room`, `my_room`, `protected_room` 공간에 맞춰 기기 카드로 자동 추가된다.
토큰이 없거나 Gateway가 꺼져 있으면 기존 mock 화면을 유지하면서 연결 상태만 표시한다.

## 현재 범위

- 2D 홈 평면도 및 방 입장 인터랙션
- 방별 조명, 에어컨, 청소기 등 기기 상태 제어
- 사용자 활동 및 센서 이벤트 mock 시뮬레이션
- Device Gateway WebSocket을 통한 Home Assistant 기기 상태 실시간 반영
- 에이전트 간 A2A 메시지 로그 시각화
- 예측 결과 및 실행 과정 대시보드

프론트엔드 기기 조작은 현재 시뮬레이션 전용이다. 실제 제어는 소유 에이전트를 거쳐야 하므로
Gateway의 읽기 전용 대시보드 토큰으로 직접 명령하지 않는다.
