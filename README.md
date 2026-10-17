# A2A-agents — Ambient-A2A 분산 스마트홈

OpenClaw 에이전트 5개가 A2A v1.0에 **Ambient-A2A 확장**([spec/ambient-a2a.md](spec/ambient-a2a.md))을 얹어 서로 소통한다. 확장은 상태 공유·구독, 공간별 소유권, 정책 기반 협업을 정의한다. 설계 배경은 [plan.md](plan.md)에 있다.

| Agent | 역할 | 포트 | 사용자 입력 | 공개 정보 / 소유 기기 |
|---|---|---|---|---|
| `externel/desktop` | external | 18800 | OpenClaw CLI / Control UI | `meeting_app_active`, `pc_state` |
| `externel/smartphone` | external | 18920 | OpenClaw 메신저 채널(예: Telegram) | `presence` |
| `internel/orchestrator` | home | 19040 | CLI | 거실 조명, TV, TV 음소거 |
| `internel/room1` | room (My Room) | 19160 | CLI | 내 방 조명, 조명 모드, 에어컨, 재실 |
| `internel/room2` | room (수면 정책 방) | 19280 | CLI | 보호 방 조명, 에어컨, 수면 모드 |

```
desktop ──"회의 시작"──▶ orchestrator ──(요청자 ACL 확인)──▶ room1 (자기 규칙으로 승인/거절)
   ▲                         │
   └──── context.query ──────┘   (home이 external 정보를 조회. 허용된 필드만 반환)
```

## 구조
- [agents/ambient-a2a-plugin/](agents/ambient-a2a-plugin/): 5개 인스턴스가 공유하는 OpenClaw 플러그인(TS). `role` 설정으로 동작이 갈린다.
  - [src/core.ts](agents/ambient-a2a-plugin/src/core.ts): ACL, 소유권, 정책, sequence와 만료 판단. I/O가 없는 순수 로직.
  - [src/agent.ts](agents/ambient-a2a-plugin/src/agent.ts): 수신 처리, 위임, 자동화 규칙, 구독.
  - [src/a2a.ts](agents/ambient-a2a-plugin/src/a2a.ts): Agent Card와 JSON-RPC wire 형식.
  - [src/ha.ts](agents/ambient-a2a-plugin/src/ha.ts): Home Assistant 클라이언트. 소유한 엔티티만 제어할 수 있다.
  - [index.ts](agents/ambient-a2a-plugin/index.ts): OpenClaw에 HTTP 라우트(`/plugins/ambient/...`), tool, 서비스를 등록한다.
- `agents/{externel,internel}/*/openclaw.json5`: 프로필별 설정(소유 기기, ACL, 정책, 규칙). `AGENTS.md`는 LLM 역할 지침이다.
- [homeassistant/](homeassistant/): 가상 기기(`input_*` helper)와 Lovelace 대시보드. 실제 기기 연동은 없다.
- [scripts/](scripts/): 실행·검증 도구.
  - `oc.sh`: 프로필별 openclaw 실행
  - `run_all.sh`: HA와 게이트웨이 5개 기동
  - `logs.sh`: 이벤트 로그 확인
  - `scenario.sh`: 검증 시나리오
  - `a2a_probe.py`: 표준 a2a-sdk 클라이언트

LLM(OpenClaw)은 사용자 의도를 해석해 `ambient_*` tool을 호출하는 역할만 한다. 정책, 소유권, 만료 판단은 플러그인 코드가 결정적으로 처리한다.

## 준비
1. **Node 24.16+**(OpenClaw 요구사항): `nvm install 24 && nvm use 24`. 그다음 `npm i -g openclaw@2026.10.4`.
2. 플러그인 의존성: `cd agents/ambient-a2a-plugin && pnpm install && pnpm test`
3. Python probe: `python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt`
4. `cp .env.example .env`. 토큰은 `openssl rand -hex 24`로 생성하고, `ANTHROPIC_API_KEY`도 채운다.
5. Home Assistant:
   1. `docker compose -f homeassistant/docker-compose.yml up -d` 실행
   2. http://127.0.0.1:8123 에서 온보딩
   3. 프로필 → 보안 → **장기 액세스 토큰**을 발급해 `.env`의 `HA_TOKEN`에 넣는다.
6. (선택) 폰 입력: smartphone 프로필에 Telegram 채널을 추가한다: `scripts/oc.sh smartphone channels add --channel telegram --token <bot-token>`

## 실행
```bash
scripts/run_all.sh          # 터미널 1: HA + 게이트웨이 5개
scripts/logs.sh             # 터미널 2: A2A 이벤트 로그
scripts/scenario.sh         # 터미널 3: 결정적 검증 (a2a-sdk)
scripts/scenario.sh --llm   #   + 자연어 흐름 ("나 회의 시작할게", "집 전체 절전해도 돼?")
scripts/scenario.sh --kill-home   # Home 중단 후에도 room1이 독립적으로 동작하는지 확인
```
대시보드: http://127.0.0.1:8123/ambient-home

직접 말 걸기: `scripts/oc.sh desktop agent --agent main --message "나 회의 시작할게"`

## 검증 항목 (plan.md 8.3)
| 항목 | 시나리오 |
|---|---|
| 외부 상태 전달 | 구독 → `context.update` → room1 조명 회의 모드 |
| 허용되지 않은 조회 차단 | home의 `pc_state` 조회 → `FIELD_NOT_ALLOWED`, 잘못된 토큰 → `UNAUTHORIZED` |
| 만료·역순 데이터 무시 | sequence 역행 또는 만료 → `STALE` |
| 자기 기기만 직접 제어 | room1이 거실 TV 제어 → `NOT_OWNER`, home은 room 기기를 위임(`delegated_to`) |
| 안전 정책 거절 | room2 수면 중 에어컨 끄기 → `SAFETY_POLICY` |
| Home 중단 시 독립 동작 | `--kill-home` |
| 집 전체 협업 | 전체 절전 → room1 실행, room2 일부 거절 → home이 `PARTIAL`로 취합 |
| 신규 Agent 연결 | home은 room Agent Card의 `owned_devices`로 소유권을 자동 학습 |

## 알려진 한계
- 토큰은 에이전트당 하나이고 피어끼리 공유한다. 상호 신뢰하지 않는 환경이라면 쌍별 토큰이나 mTLS로 바꿔야 한다.
- HA에는 엔티티별 ACL이 없다. 기기 단의 권한 검사는 플러그인 화이트리스트로 대신한다.
- 구독 정보는 publisher 메모리에만 있다. external을 재시작하면 구독하던 쪽도 재시작해야 한다.
