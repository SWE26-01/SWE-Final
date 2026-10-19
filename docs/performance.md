# 에이전트 응답 속도 (2026-10-18 측정)

desktop 에이전트에 "나 회의 시작할게" 한 턴을 보내고, 답이 올 때까지 걸린 시간을 쟀다. 측정 조건은 다음과 같다.
- 모델: OpenRouter `anthropic/claude-sonnet-5-5`
- 매 회차 새 세션으로 시작하고, 시작 전에 기기 상태(TV 음소거 off, 조명 모드 normal)를 초기화했다.
- 모든 회차가 기대한 결과로 끝났다(TV 음소거 on, 조명 모드 meeting).

## 결과

| | 기존 설정 | 바꾼 설정 | 변화 |
|---|---|---|---|
| 응답 시간 (HTTP 경로, 중앙값) | 10.95s | 6.25s | −43% |
| LLM 실행 시간 (CLI 경로, 평균) | 11.0s | 6.1s | −45% |
| 턴당 토큰 (평균, 캐시 포함) | 87.6k | 12.1k | −86% |
| 시스템 프롬프트 | 38,824자 | 8,601자 | −78% |
| 모델에 보이는 tool | 12개 | 6개 | |
| tool 호출 순서 | publish → tool_search/describe/call → request | publish → request | |

- HTTP 경로는 `scripts/say.sh`(게이트웨이 HTTP API)이고, CLI 경로는 `scripts/oc.sh <agent> agent --message ...`다.
- CLI 경로는 매번 CLI를 새로 띄우고 게이트웨이에 접속하므로, 설정과 상관없이 2~3.5초가 더 든다.
- 같은 변경을 SWE-Final 전체 스택(Gateway·Collector 경유)에 적용해 재 보니, 재시작 직후 첫 호출이 10.6s였고 이후 두 번은 5.6s, 5.8s였다. 첫 호출은 프롬프트 캐시가 비어 있어서 느리다.

### 회차별 원자료 (Gateway 없이 HA를 직접 쓰는 구성)

| 설정 | 경로 | 응답(s) | LLM 실행(s) | 토큰 | 비용($) |
|---|---|---|---|---|---|
| 기존 | CLI | 17.33 | 13.80 | 95,791 | 0.0573 |
| 기존 | CLI | 10.40 | 8.27 | 59,293 | 0.0230 |
| 기존 | HTTP | 17.47 | — | 100,367 | — |
| 기존 | HTTP | 10.95 | — | 97,946 | — |
| 기존 | HTTP | 8.88 | — | 84,705 | — |
| 바꾼 설정 | CLI | 9.46 | 5.93 | 11,507 | 0.0209 |
| 바꾼 설정 | CLI | 8.31 | 6.23 | 11,507 | 0.0107 |
| 바꾼 설정 | HTTP | 9.78 | — | 12,545 | — |
| 바꾼 설정 | HTTP | 5.12 | — | 12,506 | — |
| 바꾼 설정 | HTTP | 6.25 | — | 12,551 | — |

LLM 실행 시간과 비용은 CLI 경로에서만 보고된다. 첫 회차 비용에는 프롬프트 캐시 쓰기 비용이 포함된다.

## 무엇이 느렸나

- A2A 통신과 플러그인 판단은 수 ms다(에이전트 사이 왕복 약 20ms). 시간은 거의 다 LLM 호출에 쓰였다.
- OpenClaw 기본값은 플러그인 tool을 모델에 바로 보여 주지 않고, `tool_search` → `tool_describe` → `tool_call`로 찾게 한다. 그만큼 모델 왕복이 늘고, 회차마다 몇 번 거치는지 달라서 응답 시간이 9~17초로 흔들렸다.
- 시스템 프롬프트에 이 작업과 관계없는 내용이 많았다:
  - 코딩 도구(ls/read/edit/exec)
  - 내장 스킬 목록(약 7천 자)
  - 첫 실행용 문서(SOUL/IDENTITY/USER/BOOTSTRAP)
- `ambient_publish`의 인자가 `{fields:{...}}`로 한 단계 중첩돼 있었다. 모델이 평평한 형태로 먼저 불렀다가 실패하고 재시도한 기록이 3번 있었다.

## 바꾼 것

| 위치 | 설정 | 효과 |
|---|---|---|
| `agents/**/openclaw.json5` | `tools.toolSearch: false` | `ambient_*` tool을 모델에 바로 보여 준다 |
| 〃 | `tools.profile: "minimal"`, `alsoAllow: ["ambient-a2a"]` | Ambient-A2A tool만 남긴다 |
| 〃 | `skills.allowBundled: []` | 내장 스킬 목록을 프롬프트에서 뺀다 |
| 〃 | `agents.defaults.skipBootstrap: true` | 첫 실행용 문서를 만들지 않는다(이미 만들어진 `~/.ambient-a2a/state/*/workspace`의 SOUL/IDENTITY/USER/BOOTSTRAP.md는 지운다) |
| 〃 | `agents.defaults.thinkingDefault: "off"` | 정해진 tool을 고르는 작업이라 긴 추론을 끈다 |
| `agents/ambient-a2a-plugin/index.ts` | `ambient_publish` 인자 평탄화 | `meeting_app_active` 등 공개 필드를 바로 받는다 |
| `agents/gateway.json5` | `http.endpoints.chatCompletions.enabled` | 게이트웨이 HTTP API를 연다(loopback, 게이트웨이 토큰 필요) |
| `scripts/say.sh` | 새 스크립트 | HTTP API로 한 턴을 보낸다. CLI 기동 시간이 들지 않는다 |

## 읽을 때 주의할 점

- 회차가 적다(조건마다 2~3회). OpenRouter의 네트워크와 대기열에 따라 수 초씩 흔들릴 수 있다.
- 같은 세션에서 대화가 길어지면 프롬프트가 다시 커진다. 처음 잰 25초는 대화 기록이 쌓인 세션(프롬프트 약 54k 토큰)에서 나온 값이었다. 데모 때는 `SAY_SESSION=<장면>`으로 장면마다 새 세션을 쓴다.
- 줄인 것은 사람이 에이전트에게 말할 때의 LLM 응답 시간이다. 에이전트 사이의 요청은 원래 LLM 없이 플러그인 규칙이 처리하므로 이번 변경과 상관없다.

## 모델 변경: Sonnet 5.5 → Haiku 5.5 (2026-10-19)

같은 최적화 설정과 SWE-Final 전체 스택(Gateway·Collector 경유)에서, 기본 모델을 OpenRouter `anthropic/claude-haiku-5.5`로 바꿔 시험했다.

| | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|
| OpenRouter 가격 (입력/출력, 1M 토큰) | $2 / $10 | $0.10 / $0.50 |
| "회의 시작" 한 턴 비용 (CLI 보고값) | $0.011~0.021 | **$0.00057** |
| "회의 시작" 응답 (HTTP) | 5.6s, 5.8s | 4.1s, 3.9s (재시작 직후 첫 호출 9.1s) |
| LLM 실행 (CLI) | 5.9~6.2s | 4.0s |

시험한 흐름과 결과는 다음과 같다. 결과는 HA 상태와 A2A 로그로 확인했다.

| 흐름 | 결과 |
|---|---|
| desktop "나 회의 시작할게" (3회) | 3회 모두 TV 음소거 on, 조명 meeting |
| orchestrator "절전해도 될까? 판단만" | desktop·smartphone에 `context.query`를 보내고 실행 없이 판단(회의 중이라 보류) |
| smartphone "나 나간다" (room2 수면 중) | room1 절전, room2 에어컨은 `SAFETY_POLICY`로 유지, home이 `PARTIAL`로 취합 |
| desktop "보호 방 에어컨 꺼줘" | orchestrator를 거쳐 `UNAUTHORIZED`로 거절되고, 그 사실을 그대로 보고 |
| desktop "아기방 에어컨 끄고 거실 불도 꺼줘" | 목록에 없는 기기는 없다고 말하고, 거실 불은 `UNAUTHORIZED`를 보고 |

처음에는 권한 없는 요청에서 Haiku가 영어로 답했고, 없는 기기 ID(`climate.room2_ac`)를 지어냈으며, room2에 직접 요청했다. 그래서 `agents/**/AGENTS.md`에 다음 규칙을 넣은 뒤 다시 시험했다.
- 한국어로 답한다.
- 결과를 tool 응답 그대로 보고한다.
- 기기 요청은 orchestrator로 보낸다.
- 정해진 기기 ID 표만 쓴다.

남은 약점: 같은 세션에서 보내지 않은 요청을 "앞서 거절됐다"고 말한 적이 한 번 있었다. 기기 상태와 권한 판단은 플러그인 코드가 하므로 안전에는 영향이 없지만, 설명이 틀릴 수 있다. 데모 품질이 더 중요하면 `AMBIENT_MODEL`만 Sonnet으로 바꾸면 된다.

