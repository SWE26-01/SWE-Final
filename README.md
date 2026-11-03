# SWE-Final — Agent Hub & Studio

A2A 기반 스마트홈 에이전트 생성·연결 플랫폼 (한양대 CSE406 · LG전자 IC-PBL "Proactive Agentic Home").

자연어 요구를 검증된 에이전트 명세로 바꾸고(Studio), 공통 실행기에서 돌려 Home Agent와 연결한다(Hub).
핵심 질문: **새 에이전트를 자연어로 만들고, Home Agent 코드를 고치지 않고 연결해 집 상태에 반응하게 할 수 있는가?**

- 개발 계획: [AGENT_HUB_STUDIO_DEV_PLAN.md](AGENT_HUB_STUDIO_DEV_PLAN.md)
- 맥락과 결정: [docs/HANDOFF.md](docs/HANDOFF.md)

> 2026-11-02에 A2A based Agentic Home(OpenClaw 에이전트 5개, Ambient-A2A 확장)에서 방향을 바꿨다.
> 이전 구현은 커밋 `216840e`에 있다.

## 레포 구성

| 폴더 | 내용 |
|---|---|
| [services/](services/) | Python. Device Gateway(HA 앞에서 기기 주인 확인), Event Collector(통신 기록, 요청 흐름). Hub, 생성 서비스, 명세 검증기, 실행기, Home Agent도 여기에 추가한다 |
| [homeassistant/](homeassistant/) | 가상 기기(HA `input_*` helper)와 Lovelace 대시보드. 실제 가전 연동은 없다 |
| [scripts/](scripts/) | `setup.sh`(최초 1회: `.env` 토큰, HA 컨테이너와 토큰), `run_all.sh`(HA + Gateway + Collector) |

## 실행

```bash
scripts/setup.sh                                    # 최초 1회. 다시 실행해도 안전함
scripts/run_all.sh                                  # HA + Gateway(8100) + Collector(8200)
cd services && pip install -e ".[dev]" && pytest    # Python 테스트
```

HA 로그인은 `admin` / `.env`의 `HA_ADMIN_PASSWORD`다. 아직 화면(UI)이 없으니 사용자 역할(거실 재실, 온도, TV)은
HA의 Ambient Home 대시보드에서 바꾼다.
