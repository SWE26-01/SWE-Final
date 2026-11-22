# Extension of Smart Home: Internal & External Connectivity via A2A

**G01 | A2A-Lite** · 고라희, 신윤수, 홍예원

발표 자료: [docs/presentation/presentation.pdf](docs/presentation/presentation.pdf) (슬라이드별 설명은 [README](README.md))

---

## 1. Problem Statement

### 1.1 Single Hub bottleneck

- Amazon Alexa 같은 대부분의 플랫폼은 스마트홈 작업 전체를 **허브 기기 하나**에서 처리한다.
  작업에는 AI 추론, IoT 제어, API 호출, 에이전트 워크플로가 모두 포함된다.
- 집이 커지거나 더 높은 성능이 필요하면 허브에 더 많은 하드웨어가 필요하다. 허브가 비싸지고 시스템 전체의 병목이 된다.

→ **분산(Decentralization)이 필요하다.**

### 1.2 Lack of External Connectivity

- 최근 AI 에이전트 도구(OpenClaw, Codex 등)는 Skill, MCP, API로 연결 범위를 계속 넓히고 있다.
- 반면 스마트홈 에이전트는 집 안 기기에만 집중한다. 데스크톱(회의), 휴대폰(재실/외출), 캘린더·Slack·메일, 다른 AI 에이전트와 연결되지 않는다.

→ **집 밖과의 연결(External Connection)이 필요하다.**

---

## 2. Background: A2A Protocol

### 2.1 A2A란

- A2A(Agent2Agent)는 Google이 공개한 개방형 프로토콜로, AI 에이전트끼리 대화하고 협업하게 한다.
- 서로 다른 회사나 프레임워크로 만든 에이전트도 같은 방식으로 작업(Task)을 주고받는다.
- 각 에이전트는 **Agent Card**로 다른 에이전트를 찾고 대화한다.

### 2.2 에이전트가 협업하는 방식

- **Agent Card:** 에이전트의 "명함". 이름, 설명, URL, capabilities, skills를 담는다.
- Client 에이전트는 Agent Card를 읽어 알맞은 Remote 에이전트를 고르고 작업을 보낸다.
- 에이전트들은 JSON-RPC로 상태 업데이트와 결과(Artifact)를 주고받는다. 오래 걸리는 작업은 Task를 조회해 진행 상황을 받는다.

이 프로젝트는 **A2A v1.0**만 사용한다(`SendMessage`, `GetTask`, `TASK_STATE_*`).

---

## 3. Solution

전체 구조는 사용자의 입구인 **Root Agent**를 가운데 두고, 한쪽에 집 안 에이전트(Internal), 다른 쪽에 집 밖 에이전트(External)를 A2A로 연결한다.

```
 Internal Agents                       External: Agents Beyond the Home
┌──────────────────────┐              ┌──────────────────────────────────┐
│ Kitchen Agent        │              │ Existing Agents                  │
│  fridge·oven·hood    │              │  Desktop Agent (Calendar·Slack·  │
│ Elderly Room Agent   │     A2A      │   Mail) · Google Search Agent    │
│  fall·sleep monitor  │◀──▶ Root ◀──▶│                                  │
│ Living Room Agent    │    Agent     │ Custom Agents A, B ──publish──▶  │
│  TV·lights·AC        │  (사용자 입구) │   Agentic Hub                    │
│ + Another Root Agent │              └──────────────────────────────────┘
│   (Agent Card로 합류)  │
└──────────────────────┘
        Internal + External → 더 나은 선제적(Proactive) 실행
```

### 3.1 Internal extension: 허브 병목 해결

- 방마다 독립된 에이전트를 둔다(Kitchen, Elderly Room, Living Room 등). 각 에이전트는 **자기 방 기기의 유일한 주인**이고 자기 정책으로 판단한다.
- Root Agent는 사용자의 요청을 받아 기기의 주인에게 전달(route)할 뿐, 모든 작업을 직접 처리하지 않는다.
- 새 방이나 다른 Root Agent도 **Agent Card**만 있으면 합류한다. 집이 커져도 허브 하나에 부하가 몰리지 않는다.

### 3.2 External extension: 집 밖과 연결

- **Existing Agents:** 이미 있는 외부 에이전트와 연결한다. 예를 들어 Desktop Agent(캘린더·Slack·메일)가 "회의 중"이라는 상태를 알려 주면 집이 조용한 모드로 바뀐다. Google Search Agent 같은 범용 에이전트도 같은 방식으로 붙는다.
- **Custom Agents:** 사용자가 직접 만든 에이전트는 **Agentic Hub**에 올려(publish) 공유한다.
- 외부 에이전트에는 허용된 정보만 공개한다. 캘린더 제목, GPS 좌표 같은 원본 개인정보는 에이전트 사이로 보내지 않는다.

### 3.3 Agentic Studio & Agentic Hub

#### How to make Agents? — Agentic Studio (Web)

- 사용자가 평범한 말로 에이전트를 **만들고, 고치고, 지운다.**
  예: *"Brew my coffee at 7:30 and reorder beans when low"*
- Studio는 요청을 Hub API로 보낸다. 생성된 에이전트는 표준 A2A Agent Card를 갖는다.

```python
coffee_agent_card = AgentCard(
    name='coffee_agent',
    description='Can brew at setted time and can refill coffee bins when they are empty',
    url='https://agentichub/agents/agent?=coffeeagent/',
    version='1.0.0',
    defaultInputModes=['text'],
    defaultOutputModes=['text'],
    capabilities=AgentCapabilities(streaming=True),
    skills=[skill],
    supportsAuthenticatedExtendedCard=True,
)
```

#### How to serve Agents? — Agentic Hub (Cloud)

| 구성 | 역할 |
|---|---|
| API | Studio의 요청을 받는다 |
| Agent Information Registry (RDS) | 에이전트 정보를 저장한다 |
| Running Agents | 등록된 에이전트를 배포해 실행한다(Coffee, Training, Sleep …). 에이전트 로직은 Hub에서 돌고, 각 에이전트는 자기 SLM을 쓴다 |
| Share & Install | 다른 사용자가 에이전트를 공개(publish), 검색(search), 설치(install)한다 |

Hub의 에이전트는 집(My Home, local)의 **Root Agent**와 A2A로 작업을 보내고(tasks ↓) 결과를 받는다(results ↑).

---

## 4. 시나리오: 아침 커피

1. 사용자가 Agentic Studio에 "Brew my coffee at 7:30 and reorder beans when low"라고 입력한다.
2. Studio가 Hub API로 요청을 보내고, Hub가 Coffee Agent를 만들어 Registry에 저장한 뒤 배포한다.
3. 7:30에 Coffee Agent가 집의 Root Agent에 A2A로 커피 내리기 작업을 보낸다.
4. Root Agent는 커피 머신의 주인인 Kitchen Agent에게 작업을 넘긴다.
5. Kitchen Agent가 자기 정책을 확인한 뒤 LG DUOBO 커피 머신을 작동하고, 결과가 Coffee Agent로 돌아간다.
6. 원두가 떨어지면 Coffee Agent가 재주문한다. 다른 사용자는 Hub에서 이 에이전트를 검색해 설치할 수 있다.

**각 방 에이전트는 자기 정책으로 결정한다.** Hub의 에이전트가 요청해도 기기를 직접 움직이지 않고, 기기 주인에게 부탁한다.

---

## 5. 구현 범위

### 5.1 레포의 구성 요소

| 기획 | 레포 | 상태 |
|---|---|---|
| Root Agent, 방 에이전트, 외부 에이전트 | `agents/` (OpenClaw + `home-a2a` 플러그인): root(Root), room1·room2·kitchen(방), desktop·smartphone(외부) | 구현 |
| 기기 소유권, 방별 정책, 허용 필드만 공유 | `spec/home-a2a.md` (Home A2A 확장), 플러그인 `core.ts` | 구현 |
| 가상 스마트홈 기기 | `services/gateway`: Device Gateway가 가상 집의 기기 상태를 들고, 기기 주인을 다시 확인 | 구현 |
| Agentic Studio | `services/studio`: 자연어 → 슬롯 폼(LangChain, OpenRouter) → 기본 Skill로 규칙 생성 → 권한 잠금 검사 → 사용자 승인 → Hub 등록 | 만들기 구현, 고치기·지우기는 Hub의 연결 해제/삭제로 대신 |
| Agentic Hub | `services/agenthub`: Registry(PostgreSQL, Docker), Agent Card로 등록, 검색(`GET /agents`), 연결(설치)과 에이전트별 토큰, 기기 주인 한 명 규칙, 감사 로그 | 구현 (한 집 기준) |
| Hub 화면 | `agent_hub_FE/` (Next.js): 로그인, 카탈로그(검색·별·설치 수), 상세(권한 승인·연결·해제·공유·활동), 내 에이전트, Studio, `/home` 스마트홈 앱. 서비스 토큰은 화면 서버에만 | 구현 |
| Running Agents | `services/studio/runtime.py`: 지금은 OpenClaw로 실행, `STUDIO_RUNTIME`으로 Python 실행기로 교체 가능. Hub에서 연결하면 `scripts/launcher.mjs`가 띄우고 해제하면 멈춘다 | OpenClaw 실행 구현 |
| 에이전트별 SLM | Claude Haiku 호출로 대신한다(OpenRouter `anthropic/claude-haiku-5.5`). `training/` EXAONE SFT/DPO 실험은 기록으로 남김 ([docs/dpo-experiment.md](docs/dpo-experiment.md)) | Haiku로 대체 |
| Share & Install | `services/agenthub`: 계정(회원가입·로그인), 공유(`POST /agents/{id}/share`), 카탈로그 검색(`GET /agents?shared=true`), 별, 설치(연결) | 구현 (사용자들이 한 집을 같이 씀) |
| 클라우드 배포(RDS) | — | 계획 |

### 5.2 기술 스택

| 영역 | 기술 |
|---|---|
| Agent Communication | A2A Protocol v1.0, Home A2A 확장 |
| Agents | OpenClaw, TypeScript 플러그인 (Python 실행기로 교체 가능) |
| Backend | Python, FastAPI, Pydantic v2 |
| Agent 생성 | LangChain structured output, OpenRouter |
| Storage | PostgreSQL (Hub·Studio·Collector, Docker), 테스트는 SQLite |
| Devices | Device Gateway의 가상 기기 (HA REST와 같은 모양) |
| Frontend | Next.js (Hub 화면) |
| Testing | pytest, vitest, `scripts/scenario.sh`, `scripts/test_hub_studio.sh` |
| Deployment | Docker Compose (`docker-compose.yml`) |

### 5.3 검증 항목

- 각 방 에이전트가 자기 기기만 직접 제어하고, 다른 기기는 주인에게 요청하는가?
- 안전 정책에 어긋나는 요청을 누가 보내든 거절하는가?
- 외부 에이전트가 허용된 정보만 받는가?
- Root Agent가 멈춰도 방 에이전트가 독립적으로 동작하는가?
- 새 에이전트가 Agent Card로 합류하고, Hub가 기기 주인 중복을 막는가?
- Studio가 자연어 요청으로 만든 에이전트가 권한 잠금 검사를 통과해야만 등록되는가?

---

## 6. 기대 효과

| 기존 스마트홈 | 제안 시스템 |
|---|---|
| 허브 하나가 모든 작업을 처리 (병목) | 방 에이전트로 분산, Root Agent는 전달만 |
| 집 안 기기에만 집중 | 데스크톱·휴대폰·외부 에이전트와 A2A로 연결 |
| 에이전트를 만들려면 개발 지식 필요 | Agentic Studio에서 평범한 말로 생성 |
| 플랫폼마다 따로 연동 | Agentic Hub에서 공유·검색·설치, Agent Card로 표준 연결 |
| 중앙 판단 오류가 집 전체에 영향 | 기기마다 주인 한 명, 방별 정책으로 영향 범위 제한 |

**Internal + External → Better proactive execution.** 집 안을 분산하고 집 밖과 연결해, 사용자가 말하기 전에 집이 먼저 알맞게 움직이게 하는 것이 최종 목표다.
