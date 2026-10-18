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

## 에이전트 쪽에서 바꿀 것 (아직 안 함, 에이전트 담당자와 합의 필요)

코드는 몇 줄이다. 두 주소가 비어 있으면 지금처럼 동작하게 해 두면 된다.

1. **설정** (`agents/shared.json5`): 주소 두 개 추가
   ```json5
   gatewayUrl: "${AMBIENT_GATEWAY_URL:-}",     // 예: http://127.0.0.1:8100
   collectorUrl: "${AMBIENT_COLLECTOR_URL:-}", // 예: http://127.0.0.1:8200
   ```
2. **HA 호출을 Gateway로** (`agents/ambient-a2a-plugin/src/agent.ts`, `createAgent`): `gatewayUrl`이 있으면 HA 주소 대신
   Gateway를, HA 토큰 대신 **자기 에이전트 토큰**(`cfg.tokens[cfg.agentId]`)을 쓴다. Gateway는 HA REST API와 같은 경로
   (`GET /api/states/<entity>`, `POST /api/services/<domain>/<service>`)를 받으므로 `ha.ts`는 그대로 둔다.
   ```ts
   const myToken = cfg.tokens[cfg.agentId]; // 지금보다 위로 옮김
   const ha = cfg.ha
     ? haClient(cfg.gatewayUrl || cfg.ha.url, cfg.gatewayUrl ? myToken : cfg.ha.token, owned)
     : null;
   ```
3. **이벤트를 Collector로** (`agent.ts`, `log()`): 파일에 쓰는 줄을 그대로 보낸다. 실패해도 에이전트는 계속 동작해야 한다.
   ```ts
   if (cfg.collectorUrl)
     void fetch(`${cfg.collectorUrl}/events`, {
       method: "POST",
       headers: { authorization: `Bearer ${myToken}`, "content-type": "application/json" },
       body: JSON.stringify(line),
       signal: AbortSignal.timeout(2000),
     }).catch(() => {});
   ```
4. **`.env`**: `DASHBOARD_TOKEN`(대시보드가 Gateway·Collector를 읽을 때 쓰는 토큰). 새로 `scripts/setup.sh`를 돌리면
   `.env.example`에서 랜덤 값으로 채워지고, 기존 `.env`에는 한 줄을 직접 추가한다.

`HA_TOKEN`은 Gateway와 설정·시나리오 스크립트(`scripts/setup.sh`, `scripts/scenario.sh`)만 쓴다. 연결 후 에이전트 프로세스에는 필요 없다.

## 실행

```bash
scripts/run_all.sh                                   # HA + 에이전트 5개

cd services                                          # 루트 .env를 읽는다
uvicorn gateway.main:build --factory --port 8100 --env-file ../.env
uvicorn collector.main:build --factory --port 8200 --env-file ../.env
# 또는 docker compose up (AMBIENT_ENV=<.env 경로>, 기본 ../.env)

# 확인
scripts/scenario.sh                                  # 루트에서
python services/scripts/verify_integration.py --env-file .env
```

`verify_integration.py`가 보는 것:
1. 각 에이전트 카드의 `owned_devices`와 `services/config/devices.yaml`이 같은지
2. 각 에이전트가 남의 기기나 기기 명령이 아닌 서비스(`homeassistant.restart` 등)를 부르면 Gateway가 403으로 막는지
3. Collector에 모든 에이전트의 이벤트가 들어왔는지 (위 3번 변경 후)

## 대시보드·시뮬레이터가 받는 것

- Gateway `WebSocket /ws?token=<DASHBOARD_TOKEN>`: 접속하면 `snapshot`(기기 전체 상태), 이후 `device.state_changed`.
  형식은 `services/contracts/gateway/stream.schema.json`. 사람·구역 같은 다른 HA 엔티티는 보내지 않는다.
- Collector `WebSocket /ws?token=<DASHBOARD_TOKEN>`: 접속하면 최근 이벤트 `snapshot`, 이후 `event`.
  `GET /events?after_id=&limit=`로 페이지 조회도 된다. 형식은 `services/contracts/collector/event.schema.json`.

## ID

에이전트 ID(`desktop`, `smartphone`, `orchestrator`, `room1`, `room2`)와 기기 ID(HA 엔티티 ID)는 세 곳이 같아야 한다:
`homeassistant/config/configuration.yaml`, 각 에이전트의 `owned`(`agents/**/openclaw.json5`), `services/config/devices.yaml`.
어긋나면 `verify_integration.py` 1번이 실패한다.
