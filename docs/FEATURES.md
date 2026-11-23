# 기능서: Agent Cloud · 스마트홈 앱 · Agent Studio · API

지금 레포에서 **실제로 동작하는 기능**만 적었다. 기준일은 2026-11-22이다. 실행 방법은 [RUN.md](RUN.md), 설계 배경은 [plan.md](../plan.md)에 있다.

## 0. 한눈에

| 구분 | 주소 | 무엇 |
|---|---|---|
| Agent Cloud 화면 | http://127.0.0.1:3000 | 에이전트 찾기·설치·공유, 내 에이전트, Studio, 시나리오 |
| 스마트홈 앱 | http://127.0.0.1:3001 | 공간·기기·외부 연결, 기기의 주인 에이전트 (별도 앱. 로그인 쿠키는 Agent Cloud와 함께 씀) |
| 로그인 | http://127.0.0.1:3000/login | 회원가입·로그인 |
| Agent Hub API | :8400 (`/docs`) | 계정, 에이전트 등록·검색·공유, 연결(설치), 기기 주인 |
| Agent Studio API | :8500 (`/docs`) | 말로 에이전트 만들기, 안전 검사, 승인 |
| Device Gateway | :8100 | 가상 집의 기기. 주인 에이전트만 명령할 수 있다 |
| Event Collector | :8200 | 에이전트 요청 기록과 흐름, 에이전트 Online 상태 |
| 에이전트 | 18680 ~ 19280 (+ Studio 에이전트 19400~) | OpenClaw + `home-a2a` 플러그인. A2A v1.0 |

```
브라우저 ──(세션 쿠키)──> 화면 서버(Next.js) ──> Hub · Studio  (사람의 세션으로)
                                              └─> Collector · Gateway (읽기 전용 토큰으로, 로그인한 사람만)
Studio ──등록──> Hub ──연결하면──> 실행기(launcher) ──> Studio 에이전트 실행
에이전트 ──A2A──> 에이전트,  에이전트 ──기기 명령──> Gateway ──주인 확인──> Hub
```

**큰 규칙 세 가지**
1. 기기마다 주인 에이전트는 하나다. 기기를 움직이는 것은 주인 에이전트뿐이고, Gateway가 매번 Hub에 주인을 확인한다.
2. 에이전트는 Hub에서 **연결(설치)** 해야 동작한다. 연결할 때 사람이 권한을 승인한다.
3. 브라우저에는 서비스 토큰이 없다. 브라우저에 있는 것은 자기 로그인 세션(httpOnly 쿠키)뿐이다.

---

## 1. Agent Cloud 화면 (`/`)

화면 이름은 **Agent Cloud**다. 뒤의 API는 지금도 서비스 이름 그대로 Agent Hub(:8400)라고 부른다.

상단 바는 세 탭(Agent Hub / 내 에이전트 / Studio)과 스마트홈 앱 바로가기, 프로필 메뉴로 되어 있다.

### 1.1 기능 목록

| 화면 | 기능 | 설명 | 쓰는 API |
|---|---|---|---|
| 로그인 | 회원가입 | 아이디(영문 소문자·숫자·`_` 3~20자), 이름, 비밀번호(6자 이상). 약관·이메일 확인 없음 | `POST /api/auth/signup` |
| | 로그인 / 로그아웃 | 세션은 7일. 로그인하지 않으면 모든 화면이 `/login`으로 보낸다 | `POST /api/auth/login`, `/logout` |
| 프로필 메뉴 | 내 정보 | 이름, @아이디, 내 에이전트·스마트홈 앱 링크, 로그아웃 | `GET /api/auth/me` |
| Hub 홈 | 검색 | 검색어 또는 빠른 검색어(회의·수면·내 방·외출·절전)를 넣으면 카탈로그로 간다 | |
| | 현황 | 연결된 에이전트 수, 공유된 에이전트 수, 집의 기기 수 | `GET hub/agents`, `gateway/devices` |
| | 인기 에이전트 | 공유된 에이전트 중 별이 많은 6개 | `GET hub/agents?shared=true&sort=stars` |
| | 우리 집 에이전트 | 지금 연결된 에이전트와 Online 표시 | `GET hub/agents`, `collector/agents` |
| 카탈로그 | 검색 | 이름·설명·아이디·만든 사람으로 찾는다 | `GET hub/agents?q=` |
| | 필터 / 정렬 | 전체 · 공유된 에이전트 · 내가 만든 / 인기순 · 설치순 · 최신순 | `?shared=true`, `?mine=true`, `?sort=` |
| | 카드 | 이름, @만든 사람, 설명, 연결 여부, 등록일, 설치 수, 별 | |
| | 별 | 카드에서 바로 별을 주거나 취소한다 | `POST hub/agents/{id}/star` |
| | 개발자용 등록 | Agent Card URL로 외부 에이전트를 등록한다(모달). 처음엔 등록한 사람만 본다 | `POST hub/agents/discover` |
| 에이전트 시트 | 열기 | 어느 화면에서든 카드를 누르면 열린다. PC는 오른쪽 드로어, 폰은 바텀시트. 주소는 `?agent=<id>` | `GET hub/agents/{id}` |
| (개요 탭) | 맡는 기기 | 기기 이름과 지금 상태(켜짐·꺼짐·회의 등) | `gateway/devices` |
| | 주고받는 상태 | 공유하는 정보(예: 회의 중인지)와 읽는 정보 | |
| | 정보 | 종류·역할·공간·스킬·만든 사람·등록일·설치 수·Agent Card 주소 | |
| | 공유하기 / 공유 중지 | 만든 사람에게만 보인다. 공유하면 모든 계정의 카탈로그에 올라간다 | `POST hub/agents/{id}/share` |
| (연결 탭) | 권한 승인 | 기기 제어·정보 읽기 권한을 하나씩 체크해서 승인한다 | |
| | 우리 집에 연결(설치) | 승인한 권한으로 연결한다. 토큰은 모달에 한 번만 보인다. Studio 에이전트는 바로 실행된다 | `POST hub/connections` |
| | 주인 넘기기 | 이미 다른 에이전트가 주인인 기기면 확인 모달("room1 해제하고 연결")이 뜬다 | `GET hub/connections`, `DELETE …` |
| | 연결 해제 | 확인 모달 후 해제한다. 권한·기기 주인이 바로 풀리고 Studio 에이전트는 멈춘다 | `DELETE hub/connections/{id}` |
| | 카드 새로 읽기 / 삭제 | 삭제는 만든 사람만 할 수 있고, 확인 모달이 뜬다. 기본 에이전트는 삭제할 수 없다 | `POST …/refresh`, `DELETE hub/agents/{id}` |
| (개요 탭) | 루틴 지금 실행 | 루틴 에이전트를 정한 시각을 기다리지 않고 바로 실행한다 | `POST hub/agents/{id}/run` |
| 시나리오 | 아침 커피 | 상단 "시나리오" 탭. "지금 7:30으로 실행"을 누르면 Coffee Agent → Root → Kitchen → LG DUOBO로 요청이 움직이는 모습과 결과(커피 추출 / 원두 부족 거절)를 실제 기록 그대로 보여 준다. 주방 에이전트에게 "원두 부족으로 표시해 줘" 등을 말해 거절 경로도 시연한다 | `POST hub/agents/{id}/run`, `GET collector/flows/{id}`, `POST hub/agents/kitchen/chat` |
| (대화 탭) | 에이전트와 대화 | 연결된 에이전트에게 말을 걸고 답을 받는다. 답의 마크다운(표·목록)을 그려 주고, 대화는 이 브라우저에만 남는다(외부 에이전트는 대화 탭 없음) | `POST hub/agents/{id}/chat` |
| (활동 탭) | 최근 요청 | 누가 누구에게 무엇을 요청했고, 허용됐는지·거절됐는지와 사유 | `GET hub/agents/{id}/activity` |
| | Hub 기록 | 등록·연결·해제·공유 기록(누가, 언제) | 위와 같음 |
| 내 에이전트 | 집에서 동작 중 | 연결된 에이전트 카드에 Online, 기기 상태, 권한 수를 보여 준다 | `hub/agents`, `collector/agents`, `gateway/devices` |
| | 내가 만든 에이전트 | 공유 여부, 별, 설치 수가 보이는 카드 | `hub/agents` (`mine`) |
| 공통 | 토스트 | 연결·해제·공유·별·등록 결과를 화면 아래에 잠깐 보여 준다 | |
| | 확인 모달 | 해제·삭제·주인 넘기기·Studio 승인 전에 한 번 더 묻는다. Esc는 맨 위 창만 닫는다 | |

### 1.2 누가 무엇을 볼 수 있나

| 에이전트 | 만든 사람 | 다른 계정 |
|---|---|---|
| 기본 에이전트(집에 원래 있는 6개) | — | 항상 보임 |
| 내가 만들었고 공유 안 함 | 보임 · 공유/삭제 가능 | 안 보임. 단, 집에 연결되어 동작 중이면 보임 |
| 공유함 | 보임 · 공유 중지/삭제 가능 | 보임 · 별 · 설치(연결) 가능 |

계정은 여럿이지만 **집은 하나**다. 다른 계정이 설치한 에이전트도 같은 가상 집의 기기를 움직인다.

---

## 2. 스마트홈 앱 (:3001, `web/apps/home`)

PC에서는 가운데 한 열, 폰에서는 화면 전체로 보인다(폰 모형 프레임은 없앴다). Agent Cloud 화면과 같은 데이터를 4초마다 새로 받는다.

| 화면 | 기능 | 설명 | 쓰는 API |
|---|---|---|---|
| 헤더 | 요약 | "에이전트 N개 연결 · 기기 M개 중 K개 켜짐" | |
| | 알림 종 | 새 요청이 있으면 점이 뜬다. 누르면 활동 화면이 열린다 | `GET collector/flows` |
| 공간 탭 | 공간 목록 | 거실·내 방·보호 방·주방, 각 공간의 기기 수와 켜진 수 | `GET hub/spaces`, `gateway/devices` |
| | 공간 상세 | 그 공간의 기기(상태, 주인 에이전트)와 그 공간에서 일하는 에이전트 | |
| | 외부 기기 연결 카드 | 검색창(Enter를 누르면 외부 연결 탭으로), PC·스마트폰 버튼, 더보기(카탈로그로) | |
| 기기 탭 | 기기 목록 | 공간별 기기, 상태(켜짐·꺼짐·회의·사람 있음…), "관리: 내 방 에이전트" | |
| 기기 시트 | 주인 에이전트 | 지금 주인과, 이 기기를 맡을 수 있는 다른 에이전트 | |
| 외부 연결 탭 | 검색 | Hub 검색과 같다(+ "PC", "스마트폰" 같은 앱 전용 이름) | `GET hub/agents?q=` |
| | 사용 중 / 추가할 수 있어요 | 연결된 에이전트(Online), 연결 안 된 에이전트 | |
| | 만들기 / 카탈로그 | Agent Studio, Hub 카탈로그로 간다 | |
| 에이전트 시트 | 연결·해제·공유·별 | Hub 시트의 연결 패널을 그대로 쓴다(확인 모달 포함) | Hub와 같음 |
| 활동 | 요청 기록 | 에이전트끼리 주고받은 요청과 허용·거절 | `GET collector/flows` |
| 내 정보 | 프로필 | 이름, @아이디, 만든 에이전트 수·공유 수·받은 별, 내가 만든 에이전트, 로그아웃 | `GET /api/auth/me` |

**앱에서 안 되는 것:** 기기를 직접 켜고 끌 수 없다. 기기는 주인 에이전트만 움직이고, 앱은 상태를 보여 주고 연결로 주인을 정한다.

---

## 3. Agent Studio (Hub 화면의 Studio 탭)

| 단계 | 기능 | 설명 | 쓰는 API |
|---|---|---|---|
| 1. 쓰기 | 요청 입력 | 평범한 말로 500자까지 쓴다. ⌘/Ctrl+Enter로 만든다 | `POST studio/drafts` |
| | 공간 선택 | 자동 / 거실 / 내 방 / 보호 방 / 주방. 고른 공간은 LLM이 바꿀 수 없다 | `GET hub/spaces` |
| | 예시 | 예시 문장 세 개를 눌러서 채운다 | |
| 2. 만들기 | 진행 표시 | 입력 안전 검사 → LLM 양식 채우기 → 기본 스킬로 규칙 만들기 → 도구 잠금 검사 | |
| 2-1. 종류 결정 | 방 / 루틴 / 대화형 | 집 기기 자동화는 **방 에이전트**(기본 스킬로 규칙). "매일 7:30에 커피 내려 줘"처럼 시각이 있는 기기 요청은 **루틴 에이전트**(기기를 갖지 않고 정한 시각에 Root에게 부탁). 그 밖의 모든 요청(운동 코치, 공부, 요리…)은 **대화형 에이전트**(LLM이 쓴 행동 지침) | |
| 3. 결과 | 막힘 (`blocked`) | `rm -rf`, `sudo`, 프롬프트 인젝션 같은 위험한 내용은 LLM에 보내지 않는다 | |
| | 질문 (`clarify`) | 어느 방인지 모를 때처럼 Studio가 묻고, 사람이 답하면 다시 만든다 | `POST studio/drafts/{id}/answer` |
| | 지원 안 함 / 실패 | 명령 실행, 파일, 결제·구매, 다른 집 제어, 해로운 일만 거절한다(`unsupported`). 만들다 실패하면 `invalid`·`failed` | |
| | 승인 대기 (`ready`) | 요약(대화형이면 지침 줄마다), 요청할 권한(대화형은 없음), 알아 둘 점, 생성된 파일 | |
| 4. 승인 | 승인하고 Hub에 등록 | 확인 모달 후 등록한다. 등록된 에이전트는 **만든 사람만** 본다 | `POST studio/drafts/{id}/approve` |
| 5. 연결 | 우리 집에 연결하기 | 에이전트 시트의 연결 탭으로 간다. 연결하면 실행기가 바로 띄운다(OpenClaw가 뜨는 데 약 30초) | Hub 연결 |
| 6. 대화 | 대화 탭 | 대화형 에이전트와 이야기한다 | `POST hub/agents/{id}/chat` |
| | 최근 초안 | 내 초안만 보인다(상태 색 표시) | `GET studio/drafts` |

**기본 스킬**(`services/config/skills.yaml`): `meeting_mode`(회의 모드), `sleep_mode`(수면 모드), `energy_saving`(절전), `location_aware`(외출·귀가), `temperature_monitoring`(온도 감시). 사람이 스킬을 직접 고르지 않는다. Studio가 요청을 보고 고른다.

**안전장치:**
- LLM은 정해진 목록에서 빈칸만 채운다. 규칙, 기기 id, 도구는 코드가 만든다.
- 대화형 에이전트의 지침은 한 줄씩 최대 10줄이다. 줄마다 위험 명령·프롬프트 인젝션·마크업 검사를 거치고, 기기와 권한은 없다.
- 만들어진 에이전트는 `home-a2a` 플러그인 도구만 쓸 수 있고, 셸·파일·웹 도구는 없다.
- 파일을 쓰기 전에 다시 한 번 검사한다.
- LLM은 OpenRouter의 Claude Haiku(`anthropic/claude-haiku-5.5`)다.

---

## 4. API 기능서

### 4.0 인증 (누가 부르나)

| 호출자 | 토큰 | 할 수 있는 것 |
|---|---|---|
| 사람(계정) | Hub가 발급한 세션 토큰(7일, Hub에는 해시만 저장) | 보이는 에이전트 검색·연결·해제, 내 것 공유·삭제, 별, Studio 초안 |
| 집 관리자 | `HOME_USER_TOKEN` (스크립트·테스트용) | 사람과 같은 일을 모든 에이전트·초안에 대해 |
| 대시보드 | `DASHBOARD_TOKEN` | Gateway·Collector 읽기만 |
| Studio 서비스 | `STUDIO_TOKEN` | Hub에 에이전트 등록만 |
| runtime 서비스 | `RUNTIME_TOKEN` | Hub 토큰 확인·주인 조회, 실행기 호출. 등록은 못 함 |
| 에이전트 | 기본 6개는 `.env`, 나머지는 Hub가 발급한 토큰 | 자기 기기 명령, 이벤트 보고, A2A 요청 |

모든 요청은 `Authorization: Bearer <token>`을 쓴다. 오류는 `{"detail": {"reason_code", "message"}}` 형태다.

### 4.1 화면 서버 (Next.js, :3000)

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/auth/signup` · `/api/auth/login` | Hub에서 세션을 받아 httpOnly 쿠키(`ah_session`)에 넣는다. 토큰은 페이지에 돌려주지 않는다 |
| POST | `/api/auth/logout` | Hub 세션을 지우고 쿠키를 비운다 |
| GET | `/api/auth/me` | 지금 로그인한 사람. 없으면 401 `LOGIN_REQUIRED` |
| * | `/api/{hub\|studio\|collector\|gateway}/…` | 서버 쪽 프록시. 허용 목록(`web/packages/core/src/proxy.ts`)에 있는 요청만 통과하고, 나머지는 404 `NOT_ALLOWED` |

**프록시가 통과시키는 요청**
- **hub**
  - GET: `agents`, `agents/{id}`, `agents/{id}/activity`, `spaces`, `connections`
  - POST: `connections`, `agents/discover`, `agents/{id}/refresh|share|star`
  - DELETE: `connections/{id}`, `agents/{id}`
- **studio**
  - GET: `drafts`, `drafts/{id}`
  - POST: `drafts`, `drafts/{id}/answer|approve`
- **collector:** GET `agents`, `flows`
- **gateway:** GET `devices`

기기 명령, `tokens/verify`, 에이전트 등록은 화면에서 부를 수 없다.

### 4.2 Agent Hub (:8400)

| 메서드 | 경로 | 누가 | 설명 |
|---|---|---|---|
| POST | `/auth/signup` | 누구나 | `{username, name, password}` → 계정 생성 + 세션 `{user, token, expires_at}` |
| POST | `/auth/login` | 누구나 | `{username, password}` → 세션. 틀리면 401 `BAD_LOGIN` |
| POST | `/auth/logout` | 세션 | 그 세션 삭제 |
| GET | `/auth/me` | 토큰·세션 | `{id, name, role, member}` (Studio가 세션 확인에 쓴다) |
| GET | `/agents` | 토큰·세션 | 검색. `q`, `shared`, `mine`, `sort=created\|stars\|installs\|new`, `skill`, `space`, `role`, `origin`, `connected`. 계정에는 보이는 것만 |
| GET | `/agents/{id}` | 토큰·세션 | 에이전트 하나(만든 사람, 공유 여부, 별, 설치 수, 연결 여부) |
| POST | `/agents` | Studio | Studio가 만든 에이전트 등록(`created_by` 포함). 기기·스킬·권한을 검사한다 |
| POST | `/agents/discover` | 사람 | `{card_url}` → Agent Card를 읽고 외부 에이전트로 등록 |
| POST | `/agents/{id}/refresh` | 사람 | Agent Card를 다시 읽는다 |
| POST | `/agents/{id}/share` | 만든 사람 | `{shared}` 카탈로그 공유 / 공유 중지 |
| POST | `/agents/{id}/star` | 계정 | `{starred}` 별 / 취소 |
| POST | `/agents/{id}/run` | 사람 | 루틴 에이전트를 지금 실행 → `{request_id, results}`. Collector `GET /flows/{request_id}`로 경로를 따라간다 |
| POST | `/agents/{id}/chat` | 사람 | `{message}` → `{reply}` 연결된 에이전트와 한 번 대화한다(사람마다 대화가 따로 이어짐). 실행기를 거치고, 내용은 Hub에 저장하거나 로그로 남기지 않는다. 연결 안 됨 409 `NOT_CONNECTED`, 응답 없음 502 `AGENT_UNREACHABLE` |
| DELETE | `/agents/{id}` | 만든 사람 | 삭제(연결도 끊고 실행 중이면 멈춘다). 기본 에이전트는 400 |
| GET | `/connections` | 토큰·세션 | 연결 목록(`agent_id`, `active`로 거른다) |
| POST | `/connections` | 사람 | `{agent_id, permissions?}` 설치. 새 토큰을 한 번만 준다. Studio 에이전트는 실행기가 띄운다(`launch`) |
| DELETE | `/connections/{id}` | 사람 | 해제. 토큰·권한·기기 주인이 바로 풀린다 |
| GET | `/spaces` | 토큰·세션 | 공간별 기기와 지금 주인 |
| GET | `/ownership` | 토큰·세션 | 기기 → 지금 주인 에이전트 |
| POST | `/tokens/verify` | 에이전트·서비스 | `{token}` → 연결된 토큰인지, 권한은 무엇인지 |
| GET | `/runtime/peers` | 토큰 | 연결된 에이전트의 A2A 주소 |
| GET | `/runtime/acl/{id}` | 토큰 | 그 에이전트의 어떤 정보를 누가 읽어도 되는지 |
| GET | `/agents/{id}/activity` | 토큰·세션 | Hub 기록 + Collector의 요청 흐름 |
| GET | `/audit` | 토큰 | 전체 기록 |

**주요 오류 코드:**
- 연결·주인: `OWNERSHIP_CONFLICT`(409, 주인이 이미 있음), `ALREADY_CONNECTED`, `ALREADY_REVOKED`, `NOT_REQUESTED`
- 에이전트·기기: `UNKNOWN_AGENT`, `UNKNOWN_DEVICE`, `AGENT_EXISTS`, `INVALID_CARD`, `CARD_UNAVAILABLE`, `PLATFORM_AGENT`
- 계정·권한: `NOT_CREATOR`, `ACCOUNT_ONLY`, `USERNAME_TAKEN`, `BAD_LOGIN`

### 4.3 Agent Studio (:8500)

| 메서드 | 경로 | 누가 | 설명 |
|---|---|---|---|
| POST | `/drafts` | 사람 | `{request, space?}` → 초안. 상태는 `blocked`, `clarify`, `unsupported`, `invalid`, `failed`, `ready` 중 하나 |
| GET | `/drafts` · `/drafts/{id}` | 사람·대시보드 | 내 초안(관리자 토큰은 전부). 남의 초안은 404 |
| POST | `/drafts/{id}/answer` | 사람 | `{answer}` 질문에 답하고 다시 만든다 |
| POST | `/drafts/{id}/approve` | 사람 | Hub에 등록하고 `agents/generated/<id>/`에 실행 파일을 쓴다 → `registered` |
| POST | `/harness/check` | 사람·대시보드 | `{text}` 입력 차단 규칙에 걸리는지 확인 |
| GET | `/templates` | 사람·대시보드 | 템플릿 목록 |

**오류 코드:** `EMPTY`, `UNKNOWN_SPACE`, `UNKNOWN_DRAFT`, `NOT_ASKING`, `NOT_READY`, `HARNESS`, `HUB`, `NO_PORT`

### 4.4 Device Gateway (:8100)

| 메서드 | 경로 | 누가 | 설명 |
|---|---|---|---|
| GET | `/devices` | 에이전트·대시보드 | 모든 기기(이름, 공간, 상태, 마지막 변경 시각) |
| GET | `/api/states/{entity_id}` | 에이전트·대시보드 | 기기 하나(Home Assistant REST 형태) |
| POST | `/api/services/{domain}/{service}` | 주인 에이전트 | 기기 명령. 허용 서비스는 `input_boolean.turn_on\|turn_off\|toggle`, `input_select.select_option`, `input_number.set_value`. 주인이 아니면 403, Hub에 닿지 않으면 503(명령 거절) |
| WS | `/ws?token=` | 대시보드 | 기기 상태 실시간 |

### 4.5 Event Collector (:8200)

| 메서드 | 경로 | 누가 | 설명 |
|---|---|---|---|
| POST | `/events` | 에이전트 | 이벤트 한 줄 보고(정해진 필드만 저장하고, 개인 정보 값은 남기지 않는다) |
| GET | `/events` | 대시보드 | 이벤트 목록 |
| GET | `/flows` · `/flows/{flow}` | 대시보드 | 요청 하나를 여러 에이전트에 걸쳐 묶은 흐름(요청자, 동작, 허용·거절, 사유) |
| GET | `/agents` | 대시보드 | 에이전트별 Online과 마지막 활동 |
| WS | `/ws?token=` | 대시보드 | 이벤트 실시간 |

### 4.6 실행기 (agents 컨테이너 내부 :18700, 외부 공개 안 함)

| 메서드 | 경로 | 누가 | 설명 |
|---|---|---|---|
| POST | `/launch` | Hub(runtime 토큰) | `{id, token}` Studio 에이전트를 띄운다 |
| DELETE | `/launch/{id}` | Hub | 멈춘다 |
| GET | `/launch` | Hub | 실행 중인 목록 |
| POST | `/chat` | Hub | `{id, port, session, message}` 한 번 대화. OpenClaw 에이전트는 그 게이트웨이의 chat API로(게이트웨이 토큰은 실행기만 가짐), 가벼운 에이전트는 OpenRouter로 직접 |
| POST | `/run/{id}` | Hub | 루틴을 지금 실행: Root에 `device.control`을 보내고 Collector에 기록 |
| GET | `/agents/{id}/.well-known/agent-card.json` | 누구나 | 가벼운 에이전트(대화형·루틴)의 Agent Card. Collector가 Online 확인에 쓴다 |

### 4.7 에이전트끼리 (A2A v1.0, `…/plugins/a2a`)

- **Agent Card:** `GET /.well-known/agent-card.json`. 표준 카드이고, 역할·공간·소유 기기·공개 정보는 `skills[].tags`(`room|home|external`, `space:`, `device:`, `field:`)로 나타낸다.
- **요청:** `SendMessage`만 처리한다(바로 답을 돌려주고 작업을 남기지 않으므로 `GetTask`는 항상 -32004 task not found). 메시지는 DataPart 하나이고, `data.type`은 아래 다섯 가지 중 하나다. 자세한 필드는 [spec/home-a2a.md](../spec/home-a2a.md)에 있다.

| type | 방향 | 하는 일 |
|---|---|---|
| `context.subscribe` / `unsubscribe` | 방·집 → 외부 | 공개된 정보 구독(허용된 필드만) |
| `context.query` | 방·집 → 외부 | 공개된 정보 한 번 조회 |
| `context.update` | 외부 → 구독자 | 값이 바뀌면 알림 |
| `device.control` | 누구나 → 집·방 | 기기 제어 요청. 집 에이전트는 주인 에이전트에게 위임한다. 방 정책이 거절할 수 있다(`SAFETY_POLICY`) |

- **LLM이 쓰는 도구:** `a2a_status`, `a2a_request`, `a2a_publish`, `a2a_control`, `a2a_query`, `a2a_home_energy_saving`
- **결과 코드:** `OK`, `PARTIAL`, `UNAUTHORIZED`, `FIELD_NOT_ALLOWED`, `STALE`, `NOT_OWNER`, `SAFETY_POLICY`, `PEER_UNREACHABLE`, `EXECUTION_FAILED`, `BAD_REQUEST`

---

## 5. 아직 안 되는 것

| 항목 | 상태 |
|---|---|
| 집(가구)별 분리 | 계정은 여럿이지만 집과 기기는 하나를 같이 쓴다 |
| 앱에서 기기 직접 제어 | 설계상 없다. 주인 에이전트만 명령한다 |
| 평면도 화면(시연 이미지 왼쪽) | 없다 |
| 에이전트 LLM | Studio는 Haiku다. 에이전트는 `.env`의 `AGENT_MODEL`을 따른다(지금 레포 기본값은 Haiku) |
| 클라우드 배포(RDS/ECS) | 계획 단계 |
| 기본 에이전트 6개의 토큰 | `.env`에 고정되어 있다(Studio 에이전트는 Hub가 발급) |
| 메모리 | 1GB는 LLM이 아니라 **OpenClaw 게이트웨이(Node 프로세스)** 하나의 몫이다. 기본 에이전트 6개가 각각 하나씩 써서 약 6.4GB(Docker 7.7GB 중)다. 대화형·루틴 에이전트는 OpenClaw 없이 실행기 안에서 돌아서(OpenRouter 직접 호출) 거의 메모리를 쓰지 않는다. 기기를 맡는 Studio 방 에이전트만 1GB씩 더 든다 |
| 가상 기기 상태 | Gateway 메모리에만 있어서, 재시작하면 초기 상태로 돌아간다 |

---

## 6. 기획(plan.md) 대비 점검

| 기획 | 지금 | 판단 |
|---|---|---|
| 방마다 에이전트, 기기마다 주인 하나, Root는 전달만 (3.1) | 구현. 거실(Root)·내 방·보호 방 | ✅ |
| 외부 에이전트와 연결, 허용된 정보만 공유 (3.2) | desktop(회의 중·PC 상태)·smartphone(재실). 원본 개인정보는 보내지 않음 | ✅ |
| 범용 외부 에이전트(Google Search 등) | Agent Card URL 등록은 됨. 실제 예시 에이전트는 없음 | ⚠️ 예시 없음 |
| Studio로 **만들기** | 구현. 집 기기 자동화는 방 에이전트, 그 밖의 요청은 대화형 에이전트(화면에서 대화) | ✅ |
| Studio로 **고치기** | 없음. 새로 만들고 이전 것은 삭제해야 함 | ❌ |
| Studio로 **지우기** | Hub에서 삭제(만든 사람만) | ✅ (Hub에서) |
| Hub Registry · Share & Install | 계정, 카탈로그, 공유, 별, 설치(연결) | ✅ (집은 하나) |
| Running Agents | 연결하면 실행기가 띄우고, 해제하면 멈춤 | ✅ (로컬 Docker) |
| Hub 에이전트 → Root Agent에 A2A로 작업, Root가 주인에게 전달 (3.3, 4장) | 루틴 에이전트가 이 구조다: 기기를 갖지 않고 `request:<기기>` 권한으로 Root에게 부탁, Root가 주인에게 위임 | ✅ |
| 아침 커피 시나리오 (4장) | Coffee Agent(Studio 루틴) → Root → Kitchen → LG DUOBO가 실제로 동작하고, **시나리오 탭**에서 한 번에 보인다. 원두 부족이면 Kitchen이 정책으로 거절. 원두 재주문(외부 구매)은 안내 문구만 | ✅ (재주문은 문구만) |
| Kitchen·Elderly Room 같은 방 | 거실·내 방·보호 방·**주방** 4개 | ⚠️ Elderly Room 없음 |
| 에이전트별 SLM | Claude Haiku 호출로 대체하기로 결정 | ✅ (결정됨) |
| Registry(RDS)·클라우드 배포 | 로컬 Docker PostgreSQL | ❌ 계획 |
| 검증 항목 (5.3) 6개 | `scenario.sh`, `verify_integration.py`, `test_hub_studio.sh`, 단위 테스트로 모두 확인 | ✅ |

