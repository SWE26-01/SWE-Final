# SWE-Final — Extension of SmartHome: Internal & External Connectivity via A2A

자연어로 에이전트를 만들고(Agent Studio), 찾고 연결해(Agent Hub) 독립된 에이전트들이 A2A로 분산 협업하게 하는 플랫폼.
한양대 CSE406 소프트웨어공학 · LG전자 IC-PBL.

- 제안서: [docs/PROPOSAL.md](docs/PROPOSAL.md)
- 맥락과 결정: [docs/HANDOFF.md](docs/HANDOFF.md)

> 이전 방향(A2A based Agentic Home, 스마트홈 전용 Hub & Studio)의 코드는 커밋 `216840e`, `d81927c`에 있다.

## 레포 구성

| 폴더 | 내용 |
|---|---|
| [services/](services/) | Python. Device Gateway(HA 앞에서 기기 주인 확인), Event Collector(에이전트 통신 기록, 요청 흐름). 새 Python 서비스(Hub 등)도 여기에 추가한다 |
| [homeassistant/](homeassistant/) | 가상 기기(HA `input_*` helper)와 Lovelace 대시보드. 실제 가전 연동은 없다 |
| [scripts/](scripts/) | `setup.sh`(최초 1회: `.env` 토큰, HA 컨테이너와 토큰), `run_all.sh`(HA + Gateway + Collector) |

## 실행

```bash
scripts/setup.sh                                    # 최초 1회. 다시 실행해도 안전함
scripts/run_all.sh                                  # HA + Gateway(8100) + Collector(8200)
cd services && pip install -e ".[dev]" && pytest    # Python 테스트
```

HA 로그인은 `admin` / `.env`의 `HA_ADMIN_PASSWORD`다. 아직 화면(UI)이 없으니 가상 기기 상태는
HA의 Ambient Home 대시보드에서 바꾼다.
