# services — Device Gateway · Event Collector · Agent Hub · Studio

에이전트(`../agents`) 옆에서 네 가지를 맡는 Python 서비스. 루트의 `docker compose up -d --build`가 전부 띄운다.

- **Device Gateway** (`gateway/`): 가상 집. `config/devices.yaml`의 기기 상태를 직접 들고 있다(Home Assistant 없음).
  에이전트는 HA REST API와 같은 모양으로 자기 토큰을 들고 부르고, Gateway는 그 기기의 주인인지 확인한 뒤에만 상태를 바꾼다.
  대시보드에는 기기 상태를 WebSocket으로 보낸다. 상태는 메모리에 있어서 다시 시작하면 처음 상태(꺼짐, 또는 첫 옵션)로 돌아간다.
- **Event Collector** (`collector/`): 모든 에이전트의 A2A 통신·실행·자동화 기록을 한곳에 모으고 대시보드에 실시간으로 보낸다.
- **Agent Hub** (`agenthub/`): 에이전트 등록·검색, 연결(권한 승인, 에이전트별 토큰)과 해제. 기기마다 주인을 하나로 지킨다.
- **Agent Studio** (`studio/`): 자연어 요청을 템플릿의 빈칸 채우기로 바꿔 에이전트를 만든다(LangChain + OpenRouter). 지금 실행기는 OpenClaw이고 `STUDIO_RUNTIME`으로 바꿀 수 있다(`studio/runtime.py`). 하네스가 위험한 명령과
  권한 밖 도구를 막고, 사용자가 승인하면 Hub에 등록한다.

에이전트와 연결하는 방법: [../docs/integration.md](../docs/integration.md)

## 구조

| 폴더 | 내용 |
| --- | --- |
| `gateway/` | 가상 집(`home.py`), 주인 검사(`main.py`), 대시보드 WebSocket 메시지(`stream.py`) |
| `collector/` | 이벤트 저장(`store.py`: PostgreSQL/SQLite), 조회, 대시보드 WebSocket |
| `agenthub/` | 계정·로그인(`accounts.py`), 에이전트 등록·카탈로그·공유·별, Agent Card 읽기, 연결·해제, 토큰 확인 (PostgreSQL/SQLite) |
| `studio/` | 빈칸 양식(`slots.py`), LLM 채우기(`filler.py`), 스킬→규칙 변환(`compile.py`), 하네스(`harness.py`), 실행기 선택(`runtime.py`), OpenClaw 파일 생성(`render.py`) |
| `common/` | 서비스들이 같이 쓰는 토큰 인증, WebSocket 전달, DB 연결(`db.py`) |
| `homeconfig/` | `config/*.yaml` 로더와 검사 (토큰은 환경 변수에서 읽음) |
| `config/` | `agents.yaml`(호출자와 토큰 변수 이름), `devices.yaml`(가상 기기, 주인, 종류, 이름, 옵션), `skills.yaml`(Studio 기본 스킬. Marketplace는 없다) |
| `contracts/` | 대시보드가 받는 메시지 형식 (JSON Schema, 코드에서 생성) |
| `scripts/` | `verify_integration.py`(실행 중인 시스템 확인), `export_schemas.py` |

## 시작하기

```bash
docker compose up -d --build        # 루트에서: 서비스 4개 + PostgreSQL + 에이전트 + Hub 화면

# 서비스만 따로 개발할 때
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest
uvicorn gateway.main:build --factory --port 8100 --env-file ../.env
uvicorn collector.main:build --factory --port 8200 --env-file ../.env # collector.sqlite (Docker에서는 PostgreSQL)
uvicorn agenthub.main:build --factory --port 8400 --env-file ../.env # hub.sqlite (Docker에서는 PostgreSQL)
uvicorn studio.main:build --factory --port 8500 --env-file ../.env   # studio.sqlite, STUDIO_HUB_URL=http://127.0.0.1:8400
```

브라우저 화면이 프록시 없이 직접 읽게 하려면 `.env`에 `CORS_ORIGINS=http://localhost:3000`을 넣는다(GET만 허용).

`collector/events.py`, `collector/flows.py`, `gateway/stream.py`를 바꾸면 `python scripts/export_schemas.py`로 `contracts/`를 갱신한다.

### Agent Hub · Studio

루트의 `docker compose up -d --build`가 PostgreSQL(`postgres`, 데이터베이스 `hub`·`studio`·`collector`)과 함께 띄운다.
DB는 없으면 시작할 때 만들고, 예전 볼륨의 테이블에는 새 컬럼을 더한다. Collector는 예전 SQLite 기록(`COLLECTOR_DB`)을 빈 DB에 한 번 옮긴다.
루트 `.env`에 `HOME_USER_TOKEN`(스크립트·테스트용 집 관리자), `STUDIO_TOKEN`(Studio가 Hub에 등록할 때), `POSTGRES_PASSWORD`가 있어야 한다.
사람은 화면에서 회원가입·로그인한다(약관·이메일 확인 없는 데모).
`../scripts/setup.sh`를 다시 돌리면 빠진 키를 넣고 값을 만든다.

**HTTP로 한 번에 확인**: `../scripts/test_hub_studio.sh`(실행 중인 서비스) 또는 `../scripts/test_hub_studio.sh --local`
(uvicorn + SQLite, Docker·API 키 없이). 위험 명령 차단, 자연어(+방 선택)→에이전트, 승인·등록, 소유권 충돌,
연결·토큰·해제, 에이전트 활동 기록을 26단계로 본다.

| Studio (`:8500`) | 누가 | 하는 일 |
|---|---|---|
| `POST /drafts {request, space?}` | 사용자 (초안은 쓴 계정의 것: 다른 계정에는 404) | 요청 → 초안. `space`는 화면에서 고른 방: LLM이 바꿀 수 없다. 스킬은 사용자가 고르지 않고 요청에서 정해진다(`config/skills.yaml`). 상태: `blocked`(입력 차단) · `clarify`(질문) · `unsupported` · `invalid`(수리 2회 후에도 실패) · `failed`(LLM 호출 실패) · `ready` |
| `POST /drafts/{id}/answer {answer}` | 사용자 | `clarify` 질문에 답하고 다시 만든다 |
| `POST /drafts/{id}/approve` | 사용자 | Hub에 등록하고 `agents/generated/<id>/`에 실행기 파일을 쓴다(OpenClaw: `openclaw.json5`·`AGENTS.md`) |
| `GET /drafts`, `GET /drafts/{id}` | 사용자·대시보드 | 요약(`summary`), 요청 권한, 생성 파일 미리보기 |
| `POST /harness/check {text}` | 사용자·대시보드 | 입력 차단 규칙에 걸리는지 |
| `GET /templates` | 사용자·대시보드 | 템플릿 |

| Hub (`:8400`) | 누가 | 하는 일 |
|---|---|---|
| `POST /auth/signup {username, name, password}`, `POST /auth/login` | 누구나 | 계정 만들기·로그인. 세션 토큰은 한 번만 주고 해시만 저장(7일) |
| `POST /auth/logout`, `GET /auth/me` | 세션 | 로그아웃, 이 토큰이 누구인지(Studio가 세션 확인에 씀) |
| `GET /agents?q=&shared=&mine=&sort=stars\|installs\|new&…` | 토큰·세션 | 검색과 카탈로그(`shared=true`). 계정에는 기본 에이전트, 자기 것, 공유된 것, 지금 연결된 것만 보인다. 각 에이전트에 만든 사람·공유 여부·별·설치 수 |
| `POST /agents/{id}/share {shared}` | 만든 계정 | 카탈로그에 공유 / 공유 중지 |
| `POST /agents/{id}/star {starred}` | 계정 | 별 주기 / 취소 |
| `POST /agents` | Studio | Studio가 만든 에이전트 등록(기기·스킬·권한 검사, `created_by`) |
| `POST /agents/discover {card_url}` | 사용자 | 개발자용: 외부 에이전트를 Agent Card URL로 등록(A2A 1.0 확인). 처음엔 등록한 계정만 본다 |
| `POST /connections {agent_id, permissions?}` | 사용자 | 설치: 보이는 에이전트를 승인한 권한으로 집에 연결. 다른 에이전트가 가진 기기면 409 `OWNERSHIP_CONFLICT`. 새 토큰은 이때 한 번만 보여 주고 해시만 저장. Studio 에이전트는 실행기가 바로 띄운다(`launch`) |
| `DELETE /connections/{id}` | 사용자 | 해제: 토큰·권한·기기 소유가 바로 풀리고, Studio 에이전트는 멈춘다 |
| `POST /tokens/verify {token}` | 에이전트·서비스 | Hub가 발급한 토큰이 지금 연결돼 있는지, 권한은 무엇인지 |
| `GET /ownership`, `GET /spaces` | 토큰 있는 누구나 | 기기별 지금 주인(연결 기준)과 `devices.yaml`의 주인 |
| `GET /runtime/peers`, `GET /runtime/acl/{agent}` | 토큰 있는 누구나 | 연결된 에이전트 주소, 누가 그 에이전트의 어떤 상태를 읽어도 되는지 |
| `GET /agents/{id}/activity` | 토큰 있는 누구나 | 그 에이전트의 Hub 기록(등록·연결·해제)과, Collector `GET /flows`에서 그 에이전트가 낀 요청 흐름 |
| `GET /audit` | 토큰 있는 누구나 | 등록·연결·해제 기록 전체(토큰 없음) |

**Studio 하네스**(`studio/harness.py`): ① 요청에 `rm -rf`, `sudo`, `curl … | sh`, 디스크 삭제, 프롬프트 인젝션 등이 있으면 LLM을
부르지 않고 `blocked`. ② LLM은 템플릿·공간·기기 종류·스킬을 목록(enum)에서 고르기만 하고, 규칙과 기기 id는 코드가 만든다.
③ 이름·설명 같은 자유 문장도 같은 규칙과 한 줄·마크업 금지로 검사한다. ④ 만든 OpenClaw 프로필은 도구가 home-a2a 플러그인뿐이고
(셸·파일·웹 도구 없음), 작업 폴더·플러그인 경로가 고정이며, 자기 기기에만 동작하는지 쓰기 전에 다시 검사한다. ⑤ 사용자가 승인해야 등록된다.
문제가 나오면 LLM에게 돌려보내 최대 2번 다시 채우게 한다. LLM은 `STUDIO_LLM`(기본 LangChain + `OPENROUTER_API_KEY`,
`STUDIO_MODEL` 기본 `anthropic/claude-haiku-5.5`), `STUDIO_LLM=rules`는 키 없이 도는 키워드 채우기다.

**연결이 곧 실행이다** (Docker에서는 기본으로 켜져 있음): 사용자가 Hub에서 Studio 에이전트를 연결하면
1. Hub가 새 토큰을 agents 컨테이너의 실행기(`scripts/launcher.mjs`, `HUB_LAUNCHER_URL`, Compose 내부 전용)에 넘긴다.
   실행기는 그 에이전트 상태 폴더에만 토큰을 두고 `oc.sh <id> gateway`로 띄운다. Hub에는 해시만 남는다.
2. 플러그인(`hubUrl`)은 모르는 토큰을 Hub `POST /tokens/verify`로 확인하고, 상대 주소는 `GET /runtime/peers`, desktop 같은
   외부 에이전트의 공개 범위는 `GET /runtime/acl/<자기>`, Home의 위임 대상은 `GET /ownership`으로 정한다.
3. Gateway(`GATEWAY_HUB_URL`)는 Hub 토큰을 확인하고, 기기의 주인을 `devices.yaml`이 아니라 지금 연결된 주인(`GET /ownership`)으로
   판단한다. Hub에 닿지 않으면 명령을 거절한다. Collector(`COLLECTOR_HUB_URL`)도 Hub 토큰의 이벤트를 받고 상태를 본다.
4. 연결을 해제하거나 에이전트를 삭제하면 실행기가 멈추고, 몇 초(캐시) 안에 그 토큰은 Gateway·다른 에이전트에서 거절된다.
   컨테이너가 다시 뜨면 실행기는 Hub가 아직 받아 주는 토큰의 에이전트만 다시 띄운다.

이 세 서비스는 `runtime` 서비스 토큰(`RUNTIME_TOKEN`, `config/agents.yaml`)으로 Hub에 묻는다. 이 토큰으로는 에이전트를 등록할 수 없다.
OpenClaw gateway 하나가 메모리를 약 1GB 쓰므로, Studio 에이전트를 여러 개 띄우려면 Docker Desktop 메모리를 늘려야 한다(기본 5개 + 1개면 약 6.5GB).

