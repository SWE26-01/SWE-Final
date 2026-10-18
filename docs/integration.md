# 에이전트와 services 연동

에이전트(`agents/`, OpenClaw) 옆에서 `services/`가 두 가지를 맡는다.

```
에이전트 ──(HA REST와 같은 모양, 자기 토큰)──▶ Device Gateway ──(HA 토큰)──▶ Home Assistant
   │                                          │
   └──(이벤트 로그 한 줄씩, 자기 토큰)──▶ Event Collector   └──(WebSocket 기기 상태)──▶ 대시보드·시뮬레이터
                                         └──(WebSocket 이벤트)──────────────────▶ 대시보드·시뮬레이터
```

- **Device Gateway**: 에이전트가 Home Assistant 대신 부르는 검문소. 요청한 에이전트가 그 기기의 주인인지
  `services/config/devices.yaml`로 다시 확인하고, 통과한 명령만 진짜 HA 토큰으로 넘긴다. HA에는 기기별 권한이 없어서
  지금은 각 에이전트가 자기 코드로만 막고 있다(`ha.ts`의 화이트리스트). Gateway는 그 코드와 상관없이 막는 두 번째 검사다.
- **Event Collector**: 각 에이전트의 `logs/events.jsonl` 한 줄을 그대로 받아 한곳에 모으고, 대시보드에 실시간으로 보낸다.

## 켜는 방법

**SWE-Final에서는 기본으로 켜져 있다.** `scripts/run_all.sh`가 `services/`의 Gateway·Collector를 Docker로 함께 띄우고,
에이전트가 그쪽을 쓰게 한다(SWE26-01/A2A-agents#2). 30초 안에 안 뜨면 경고를 내고 HA를 직접 쓴다. `AMBIENT_SERVICES=off`로 끌 수 있다.

주소를 바꾸려면 루트 `.env`에 넣는다. 비워 두면 아래 기본값을 쓴다. A2A-agents 레포만 따로 돌릴 때는 `services/`가 없어서 예전처럼 HA를 직접 쓴다.

```bash
AMBIENT_GATEWAY_URL=http://127.0.0.1:8100    # HA 호출이 Gateway로, 공용 HA 토큰 대신 각 에이전트 자기 토큰으로
AMBIENT_COLLECTOR_URL=http://127.0.0.1:8200  # 이벤트 로그 한 줄마다 Collector에도 전송 (실패해도 에이전트는 계속 동작)
DASHBOARD_TOKEN=...                          # 대시보드가 Gateway·Collector를 읽는 토큰 (setup.sh가 새 .env에 자동으로 채움)
```

- 코드: `agents/shared.json5`(`gatewayUrl`, `collectorUrl`), `agents/ambient-a2a-plugin/src/agent.ts`(`createAgent`, `log()`),
  테스트 `agents/ambient-a2a-plugin/src/services.test.ts`. Gateway가 HA REST API와 같은 경로를 받아서 `ha.ts`는 그대로다.
- Gateway를 켜면 에이전트는 `services/config/devices.yaml`에 있는 엔티티만 읽고 쓸 수 있다. 에이전트 정책이 새 HA 엔티티를 보게 되면
  `devices.yaml`에도 추가해야 한다.
- `HA_TOKEN`은 Gateway와 설정·시나리오 스크립트(`scripts/setup.sh`, `scripts/scenario.sh`)만 쓴다.
- 에이전트 코드는 A2A-agents가 원본이다. 고칠 때는 그 레포에 PR을 올리고 `tools/sync_upstream.sh`로 가져온다.

## 실행

```bash
scripts/run_all.sh                                   # HA + Gateway·Collector + 에이전트 5개 (Ctrl-C는 에이전트만 멈춤)

# services만 따로 띄울 때 (루트 .env를 읽는다)
cd services && docker compose up -d --build
# 또는 uvicorn gateway.main:build --factory --port 8100 --env-file ../.env (collector는 8200)

# 확인
scripts/scenario.sh                                  # 루트에서
python services/scripts/verify_integration.py --env-file .env
```

`verify_integration.py`가 보는 것:
1. 각 에이전트 카드의 `owned_devices`와 `services/config/devices.yaml`이 같은지
2. 각 에이전트가 남의 기기나 기기 명령이 아닌 서비스(`homeassistant.restart` 등)를 부르면 Gateway가 403으로 막는지
3. Collector에 모든 에이전트의 이벤트가 들어왔는지

2026-10-18 로컬 실제 환경(HA + 에이전트 5개 + Docker Gateway·Collector)에서 `scripts/scenario.sh` 후 세 항목 모두 통과했다.

## 대시보드·시뮬레이터가 받는 것

- Gateway `WebSocket /ws?token=<DASHBOARD_TOKEN>`: 접속하면 `snapshot`(기기 전체 상태), 이후 `device.state_changed`.
  형식은 `services/contracts/gateway/stream.schema.json`. 사람·구역 같은 다른 HA 엔티티는 보내지 않는다.
- Collector `WebSocket /ws?token=<DASHBOARD_TOKEN>`: 접속하면 최근 이벤트 `snapshot`, 이후 `event`.
  `GET /events?after_id=&limit=`로 페이지 조회도 된다. 형식은 `services/contracts/collector/event.schema.json`.
- Collector `GET /flows?limit=`: 요청 하나를 에이전트를 넘나들며 묶은 요약(누가 요청, 누가 받음, 어떤 기기, 최종 수락·거절과 사유), 최근 것부터.
  `GET /flows/{flow}`는 그 요청의 이벤트 전체. 이벤트마다 `flow` 값이 붙어 있어서 WebSocket에서도 바로 묶을 수 있다.
  형식은 `services/contracts/collector/flow.schema.json`. 에이전트가 `request_id`를 위임·실행·절전(`<id>/<room>`)·자동화 규칙까지
  이어 주기 때문에 가능하다(`spec/ambient-a2a.md`).

## ID

에이전트 ID(`desktop`, `smartphone`, `orchestrator`, `room1`, `room2`)와 기기 ID(HA 엔티티 ID)는 세 곳이 같아야 한다:
`homeassistant/config/configuration.yaml`, 각 에이전트의 `owned`(`agents/**/openclaw.json5`), `services/config/devices.yaml`.
어긋나면 `verify_integration.py` 1번이 실패한다.
