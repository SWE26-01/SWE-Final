# 에이전트와 services 연동

에이전트(`agents/`, OpenClaw) 옆에서 `services/`의 두 서비스가 기기와 기록을 맡는다.

```
에이전트 ──(HA REST와 같은 모양, 자기 토큰)──▶ Device Gateway (가상 집: 기기 상태를 직접 들고 있음)
   │                                          └──(WebSocket 기기 상태)──▶ 화면
   └──(이벤트 로그 한 줄씩, 자기 토큰)──▶ Event Collector ──(WebSocket 이벤트, /flows)──▶ 화면
```

- **Device Gateway**: 기기는 Gateway에만 있다(Home Assistant 없음). 요청한 에이전트가 그 기기의 주인인지
  `services/config/devices.yaml`로 확인하고, 통과한 명령만 기기 상태를 바꾼다. 에이전트 코드(`devices.ts`)도 자기 기기만 부르지만,
  Gateway는 그 코드와 상관없이 막는 두 번째 검사다.
- **Event Collector**: 각 에이전트의 `logs/events.jsonl` 한 줄을 그대로 받아 한곳에 모으고, 화면에 실시간으로 보낸다.

## 켜는 방법

`docker compose up -d --build`(또는 `scripts/run_all.sh`)가 에이전트와 서비스를 같이 띄우고, Docker 안에서 에이전트가
`http://gateway:8100`, `http://collector:8200`을 쓰게 한다.

에이전트를 호스트에서 직접 돌릴 때(`scripts/oc.sh`)는 루트 `.env`의 주소를 쓴다.

```bash
DEVICE_GATEWAY_URL=http://127.0.0.1:8100    # 기기. 비워 두면 이 기본값
EVENT_COLLECTOR_URL=http://127.0.0.1:8200  # 이벤트 로그 (비우면 끔. 실패해도 에이전트는 계속 동작)
DASHBOARD_TOKEN=...                          # 화면이 Gateway·Collector를 읽는 토큰 (setup.sh가 채움)
```

- 코드: `agents/shared.json5`(`gatewayUrl`, `collectorUrl`), `agents/home-a2a-plugin/src/agent.ts`(`createAgent`, `log()`),
  `src/devices.ts`(Gateway 클라이언트), 테스트 `src/services.test.ts`.
- 에이전트 정책이 새 기기를 보게 되면 `devices.yaml`에도 추가해야 한다. Gateway에 없는 기기는 읽을 수도 없다.

## 확인

```bash
scripts/scenario.sh                                  # 루트에서 (scripts/setup.sh --local로 probe venv 필요)
python services/scripts/verify_integration.py --env-file .env
```

`verify_integration.py`가 보는 것:
1. 각 에이전트 카드의 `owned_devices`와 `services/config/devices.yaml`이 같은지
2. 각 에이전트가 남의 기기나 기기 명령이 아닌 서비스(`homeassistant.restart` 등)를 부르면 Gateway가 403으로 막는지
3. Collector에 모든 에이전트의 이벤트가 들어왔는지

2026-11-20 `docker compose up`으로 띄운 전체에서 `scripts/scenario.sh --kill-home` 후 세 항목 모두 통과했다.

## 화면이 받는 것

- Gateway `WebSocket /ws?token=<DASHBOARD_TOKEN>`: 접속하면 `snapshot`(기기 전체 상태), 이후 `device.state_changed`.
  형식은 `services/contracts/gateway/stream.schema.json`.
- Collector `WebSocket /ws?token=<DASHBOARD_TOKEN>`: 접속하면 최근 이벤트 `snapshot`, 이후 `event`.
  `GET /events?after_id=&limit=`로 페이지 조회도 된다. 형식은 `services/contracts/collector/event.schema.json`.
- Collector `GET /flows?limit=`: 요청 하나를 에이전트를 넘나들며 묶은 요약(누가 요청, 누가 받음, 어떤 기기, 최종 수락·거절과 사유), 최근 것부터.
  `GET /flows/{flow}`는 그 요청의 이벤트 전체. 형식은 `services/contracts/collector/flow.schema.json`.
  에이전트가 `request_id`를 위임·실행·절전(`<id>/<room>`)·자동화 규칙까지 이어 주기 때문에 가능하다(`spec/home-a2a.md`).
- 브라우저에서 프록시 없이 직접 읽으려면 루트 `.env`에 `CORS_ORIGINS=http://localhost:3000`(쉼표로 여러 개)을 넣는다.
  GET만 허용하고, 비워 두면 허용하지 않는다.

## ID

에이전트 ID(`desktop`, `smartphone`, `root`, `room1`, `room2`)와 기기 ID(HA 엔티티 ID 형식)는 세 곳이 같아야 한다:
`services/config/devices.yaml`, 각 에이전트의 `owned`(`agents/**/openclaw.json5`), 각 에이전트 `AGENTS.md`의 기기 표.
어긋나면 `verify_integration.py` 1번이 실패한다.
