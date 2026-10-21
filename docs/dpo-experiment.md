# EXAONE 4.0 1.2B 에이전트 학습 실험 (SFT → DPO)

스마트홈 에이전트의 LLM을 Claude Haiku 5.5 대신 LG EXAONE 4.0 1.2B로 돌릴 수 있는지 시험한 기록이다. 기본 모델은 계속 Haiku이고, 이 실험은 에이전트 설정을 바꾸지 않는다. 실행 방법은 [training/README.md](../training/README.md)에, 숫자와 설정 전체는 [training/experiment.json](../training/experiment.json)에 있다.

**현재 상태 (2026-10-21)**: SFT 학습과 평가를 마쳤고, DPO는 Colab에서 학습 중이다.

## 1. 왜 학습했나

기본 EXAONE 1.2B를 에이전트에 그대로 붙이면 평가 질의 6개 중 하나도 통과하지 못한다. 주로 이렇게 틀렸다.
- **하지 않은 일을 했다고 말한다.** "회의 시작할게"에 상태만 공유하고는 "TV 음소거와 조명을 허용했습니다"라고 답했다.
- **없는 tool을 지어낸다.** `presence`라는 tool은 없다.
- **멈추지 못한다.** 같은 tool을 100번 넘게 부르다가 300초 제한에 걸렸다.
- **지시를 어긴다.** "실행은 하지 마"라고 했는데 집 전체 절전을 실행했다.
- **영어로 답한다.**

그래서 두 단계로 학습했다.
1. **SFT**: Haiku가 실제로 낸 정답 응답을 그대로 따라 하게 한다.
2. **DPO**: 같은 요청에서 기본 EXAONE의 틀린 응답보다 Haiku 응답을 더 고르게 한다.

## 2. 데이터셋

### 2.1 어떻게 모았나

```
scenarios.py(54개 질의) → 에이전트(OpenClaw, Haiku) → proxy.py(요청·응답 기록) → calls.jsonl
                                                                  └→ run_scenarios.py가 결과 판정 → results.jsonl
```

- **원본 그대로**: 학습 데이터는 OpenClaw가 모델에 실제로 보낸 요청이다. 시스템 프롬프트, tool 정의 6~8개, 대화가 모두 들어 있다. 따로 만든 대화가 아니라서 학습한 모델이 실제 에이전트에서 받을 입력과 같다.
- **연습 질의 54개**: 에이전트마다 실제 역할에 맞게 만들었다. desktop 25, smartphone 10, orchestrator 12, room1 4, room2 3이다. 회의 시작·종료, 외출·귀가, 권한 없는 요청, 목록에 없는 기기, 개인정보 공유 요청, "판단만 해 줘", 수면 정책 같은 경우를 담았다.
- **평가용 6개는 학습에서 뺐다**: `HELDOUT`의 6개 질의는 원래 검증 시나리오다. 학습 데이터에는 표현을 바꾼 질의만 들어간다.
- **정답(Haiku) 수집은 3번 했다**:

  | 수집 | 통과 | 비고 |
  |---|---|---|
  | haiku1 | 51/54 | |
  | haiku2 | 38/54 | 플러그인 버그(상태 조회 뒤 공유가 깨짐) 때문에 실패가 많았다. 버그는 고쳤다(`5840ae3`) |
  | haiku3 | 50/54 | |

- **걸러낸 것**:
  - Haiku가 자동 검사를 통과한 시나리오의 호출만 쓴다.
  - 대화 안에 tool 오류가 있으면 뺀다.
  - `.env`의 토큰·키 값이 데이터에 섞이면 파일을 만들지 않는다.

### 2.2 무엇이 들어 있나

파일은 [training/data/ambient-dpo-data.zip](../training/data/ambient-dpo-data.zip)이다. 압축을 풀면 4개 파일이 나온다. 시나리오 단위로 15%(7개)를 검증용으로 나눴다.

| 파일 | 개수 | 한 줄의 내용 |
|---|---|---|
| `sft_train.jsonl` / `sft_eval.jsonl` | 227 / 37 | `prompt`(대화) + `tools` + `completion`(Haiku 응답) |
| `dpo_train.jsonl` / `dpo_eval.jsonl` | 179 / 33 | `prompt` + `tools` + `chosen`(Haiku) + `rejected`(기본 EXAONE) |

예시는 [sample-sft-row.json](../training/data/sample-sft-row.json)과 [sample-dpo-pair.json](../training/data/sample-dpo-pair.json)에 있다. 시스템 프롬프트는 길어서 앞부분만 남겼다. DPO 예시는 "회의 들어갈게"에 대한 응답 두 개다.
- chosen(Haiku): 상태 공유, TV 음소거 요청, 조명 회의 모드 요청을 모두 했다.
- rejected(기본 EXAONE): 상태만 공유하고 영어로 답했다.

예제 하나는 4,592토큰(중앙값)이고 가장 긴 것은 6,012토큰이다. 대부분은 시스템 프롬프트와 tool 정의다.

### 2.3 DPO의 "틀린 응답"은 어떻게 골랐나

Haiku 응답 하나마다 같은 요청을 기본 EXAONE에 다시 보냈다.
1. 먼저 온도 0.0으로 보낸다.
2. 틀리지 않았으면 온도 0.8로 두 번 더 보낸다.
3. 처음으로 틀린 응답이 나오면 그것을 rejected로 쓴다.

결과: 264개 중 212개에서 틀린 응답이 나왔다(온도 0.0에서 177개, 0.8에서 35개).

**틀린 것의 기준**:
- Haiku가 tool을 불렀으면, EXAONE의 tool 이름이나 핵심 인자(대상·기기·명령·값·필드)가 하나라도 다를 때 틀린 것으로 본다.
- Haiku가 최종 답변을 했으면, EXAONE이 tool을 불렀거나 한국어로 답하지 않았을 때 틀린 것으로 본다.

| 틀린 방식 | 쌍 수 |
|---|---|
| 다른 tool을 고름 | 81 |
| 최종 답변이 한국어가 아님 | 59 |
| 답해야 할 때 tool을 또 부름 | 49 |
| tool은 같지만 대상·기기·명령이 다름 | 18 |
| tool을 불러야 할 때 글로만 답함 | 5 |

## 3. 학습

- **장소**: Google Colab T4. 터미널의 [Colab CLI](https://github.com/googlecolab/google-colab-cli)로 돌렸다. [training/train_colab.py](../training/train_colab.py)는 [ambient_dpo.ipynb](../training/ambient_dpo.ipynb)와 같은 코드다.
- **라이브러리**: TRL 1.16, PEFT 0.21, transformers 5.20, torch 2.11.
  - LLaMA-Factory에는 EXAONE 4.0의 tool 호출 형식에 맞는 템플릿이 없어서 TRL로 직접 했다.
- **텍스트 만들기**: 모델 자신의 chat template(tool 포함)으로 대화를 문자열로 바꿨다. llama.cpp로 서빙할 때와 같은 형식이다.
- **LoRA**: r 16, alpha 32, dropout 0.05, 모든 linear 층. 1.29B 중 1,524만 개(1.2%)만 학습한다.

| | SFT | DPO |
|---|---|---|
| 시작 모델 | EXAONE 4.0 1.2B | SFT 모델 (LoRA 병합) |
| 기준(reference) 모델 | — | LoRA를 끈 SFT 모델 |
| epoch / step | 3 / 87 | 1 / 23 (처음엔 2 epoch로 계획) |
| 학습률 | 2e-4 | 5e-6, beta 0.1 |
| batch | 1 × 누적 8 | 1 × 누적 8 |
| 최대 길이 | 8,192 토큰 | 8,192 토큰 |
| loss | 답변 부분만 | chosen/rejected 비교 |
| 시간 (T4) | 59분 | 약 52분 예상 |

학습이 끝나면 GGUF(Q8_0)로 바꿔 이 Mac의 llama.cpp에서 평가한다.

## 4. 결과 (평가 질의 6개)

| | EXAONE 원본 | EXAONE + SFT | EXAONE + SFT + DPO | Haiku 5.5 |
|---|---|---|---|---|
| 자동 검사 통과 | 0/6 | **6/6** | 학습 중 | 6/6 |
| 답변 내용까지 맞음 | 0/6 | **4/6** | 학습 중 | 6/6 |
| 응답 시간 (중앙값) | 10.0초 | 11.7초 | — | 4.2초 |

- **자동 검사**는 기기의 실제 상태(Home Assistant), 에이전트가 보낸 요청(A2A 기록), 한국어 여부, 거절 사유 언급을 본다.
- **SFT 모델의 내용 오류 2개**:
  - 목록에 없는 "아기방"을 내 방 에어컨으로 바꿔 요청했고, 답변에서는 "보호 방 에어컨"이라고 말했다.
  - "판단만 해 줘"에서 회의 중인데도 "절전을 시도할 수 있다"고 거꾸로 판단했고, 하지 않은 요청을 했다고 말했다.
  - 기기와 권한은 플러그인 코드가 막기 때문에 실제 피해는 없었다.
- **응답 시간**: EXAONE은 이 Mac(llama.cpp)에서, Haiku는 OpenRouter에서 쟀다. 그래서 직접 비교하기 어렵다.
- **질의별 비교**: 모델마다 실제로 부른 tool과 답변을 나란히 볼 수 있다. 데이터는 [training/data/eval-heldout-results.json](../training/data/eval-heldout-results.json)이고, 페이지는 [비교 페이지](https://claude.ai/artifact/8Wb41zCTwzQ2r4toPtWvM5)다. 페이지는 비공개라 공유해야 볼 수 있다.

## 5. 진행 중 겪은 문제

| 문제 | 해결 |
|---|---|
| llama.cpp가 EXAONE 공식 템플릿의 `{% continue %}`를 처리하지 못해 tool 정의와 시스템 프롬프트가 조용히 사라짐 | 같은 의미로 고친 템플릿(`training/exaone4-chat_template.jinja`) 사용 |
| 상태를 한 번 물어보면 그 에이전트가 이후 상태 공유를 못 함 (OpenClaw가 tool 결과를 얼리는데 내부 상태가 딸려 나감) | `ambient_status`가 복사본을 돌려주게 고침(`5840ae3`). **데모에도 영향이 있던 버그** |
| Colab의 torchao 0.10을 새 PEFT가 거부 | torchao 제거 (쓰지 않음) |
| T4에서 6천 토큰 예제가 메모리 부족 (12GiB 이상) | transformers가 SDPA에 `enable_gqa`를 넘기면, FlashAttention이 없는 T4는 전체 어텐션 행렬을 만드는 커널을 쓴다. 이 옵션을 끄자 1.5GiB가 됐다 |
| `colab exec`로 긴 학습을 돌리면 응답 대기 시간이 끝나면서 실행도 멈춤 | 학습을 커널 안에서 돌리고, 로그는 파일로, 상태는 별도 shell(`console`)로 확인 |
| Mac이 잠들거나 재부팅되면 감시가 끊기고, Colab 세션이 회수돼 학습이 날아감 (두 번) | 학습을 커널 안에서 돌려 Colab이 사용 중으로 보게 함. SFT 결과를 체크포인트로 남겨 DPO부터 다시 시작할 수 있게 함 |

## 6. 한계와 다음 단계

- 평가 질의가 6개뿐이다. 검증용 7개 시나리오로도 비교할 예정이다.
- DPO의 rejected는 **기본 EXAONE**의 실수다. 그래서 SFT 모델이 실제로 하는 실수(그럴듯하지만 틀린 설명)와는 다를 수 있다. 다음에는 SFT 모델의 응답으로 rejected를 다시 만드는 것(on-policy)이 효과적일 것이다.
- 자동 검사는 기기 상태와 요청만 본다. 답변의 설명이 맞는지는 사람이 읽어야 한다. 설명 오류를 잡는 검사를 추가할 필요가 있다.
