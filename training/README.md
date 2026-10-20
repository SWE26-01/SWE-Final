# EXAONE 4.0 1.2B 에이전트 학습 (SFT → DPO)

이 폴더는 스마트홈 에이전트의 LLM을 LG EXAONE 4.0 1.2B로 바꿔 쓰기 위한 실험이다. 기본 모델은 지금 Claude Haiku 5.5이고, 이 실험은 그 설정을 건드리지 않는다.

## 왜 학습하나

기본 EXAONE 1.2B를 그대로 에이전트에 붙이면 평가 6개 흐름 중 1개만 통과한다. 자주 보이는 실패는 이렇다.
- 기기 이름을 빼먹거나, 요청을 orchestrator가 아닌 방에 직접 보낸다.
- 없는 tool이나 없는 기기 ID를 지어낸다.
- 영어로 답한다.
- "판단만 해 줘"라고 해도 절전을 실행한다.

그래서 Haiku가 실제로 낸 정답 응답을 따라 하게 하고(SFT), 같은 요청에서 기본 EXAONE의 틀린 응답보다 Haiku 응답을 고르게 한다(DPO).

## 흐름

```
scenarios.py ──run_scenarios.py──▶ 에이전트(OpenClaw) ──▶ proxy.py ──▶ Haiku(OpenRouter)
                                                           │ 요청·응답 기록 (calls.jsonl)
build_dataset.py ── 같은 요청을 기본 EXAONE(llama.cpp)에 다시 보내 비교 ──▶ sft/dpo jsonl + zip
ambient_dpo.ipynb (Colab GPU) ── SFT → DPO → GGUF ──▶ lab.sh serve → run_scenarios.py --set heldout
```

- 학습 데이터는 OpenClaw가 모델에 실제로 보낸 요청(시스템 프롬프트, tool 정의, 대화) 그대로다.
- 학습에 쓰는 시나리오는 54개다. 평가용 6개 흐름(`HELDOUT`)은 학습에 쓰지 않는다.
- 데이터, venv, 모델 파일은 `~/.ambient-a2a/`에 둔다. 레포에는 코드만 둔다.

## 실행 순서

먼저 HA·Gateway·Collector가 떠 있어야 한다(`scripts/run_all.sh`, 또는 메인 체크아웃에서 `docker compose`).

```bash
training/lab.sh setup                      # 1회: venv, llama.cpp, EXAONE GGUF
training/lab.sh serve &                    # 기본 EXAONE (:8090)
training/lab.sh proxy &                    # 기록용 프록시 (:8300)
training/lab.sh agents haiku               # 에이전트를 lab/haiku로 (프록시 경유)

PY=~/.ambient-a2a/venvs/lab/bin/python
caffeinate -i $PY training/run_scenarios.py --set train --tag haiku1      # 정답 수집 (여러 번 돌려도 됨: haiku2 …)
caffeinate -i $PY training/build_dataset.py --teacher haiku --samples 3 --zip
~/.ambient-a2a/venvs/trl/bin/python training/smoke_test.py                 # 노트북 코드를 작은 모델로 미리 확인
```

Colab 학습은 두 가지 방법이 있다.

**A. 터미널 ([Colab CLI](https://github.com/googlecolab/google-colab-cli), 권장)**: `uv tool install google-colab-cli`로 설치한다. 처음 한 번은 `colab sessions`를 실행해 Google 로그인을 마친다.
```bash
C=~/.local/bin/colab
$C new -s ambient --gpu T4                                   # 무료 계정은 T4. Pro면 L4/A100
$C install -s ambient "trl==1.16.0" "peft>=0.17" "transformers>=4.56" "accelerate>=1.10" "datasets>=4.0"
$C upload -s ambient ~/.ambient-a2a/training/ambient-dpo-data.zip /content/ambient-dpo-data.zip
$C upload -s ambient training/train_colab.py /content/train_colab.py
echo 'cd /content && nohup python3 -u train_colab.py > /content/train.log 2>&1 &' | $C console -s ambient
# 진행 상황 보기 (학습은 VM 안의 별도 프로세스라 로컬 연결이 끊겨도 계속된다)
echo 'print(open("/content/train.log").read()[-2000:])' | $C exec -s ambient
$C download -s ambient /content/out/EXAONE-4.0-1.2B-ambient-dpo-Q8_0.gguf ~/.ambient-a2a/models/
$C stop -s ambient
```
- `colab exec -f train_colab.py`로 바로 돌리면, 오래 걸리는 학습 중에 CLI의 응답 대기 시간이 끝나면서 실행도 같이 멈춘다. 그래서 `nohup`으로 띄운다.
- `train_colab.py`는 `make_notebook.py`가 노트북과 같은 코드로 만든다. 직접 고치지 않는다.

**B. 브라우저**:
1. `training/ambient_dpo.ipynb`를 Colab에 올린다(파일 → 노트북 업로드).
2. GPU 런타임을 켠다.
3. 위에서부터 차례로 실행한다. 첫 셀에서 zip을 고른다.
4. 마지막 셀에서 GGUF를 내려받아 `~/.ambient-a2a/models/`에 넣는다.

평가:
```bash
training/lab.sh serve ~/.ambient-a2a/models/EXAONE-4.0-1.2B-ambient-dpo-Q8_0.gguf 8091 &
training/lab.sh agents exaone-dpo
$PY training/run_scenarios.py --set heldout --tag eval-exaone-dpo
```

## 알아 둘 점

- **llama.cpp 템플릿**: EXAONE 4.0 공식 chat template의 `{% continue %}`를 llama.cpp가 처리하지 못한다. 그러면 tool 정의와 시스템 프롬프트가 조용히 사라진다. `exaone4-chat_template.jinja`는 같은 내용을 `continue` 없이 고친 것이고, `lab.sh serve`가 이 파일을 쓴다.
- **LLaMA-Factory 대신 TRL**: LLaMA-Factory에는 EXAONE 4.0의 tool 호출 형식(`<tool_call>…</tool_call>`, `[|tool|]<tool_result>`)에 맞는 템플릿이 없다. 노트북은 모델 자신의 chat template으로 텍스트를 만들어 TRL로 학습한다. 서빙할 때 llama.cpp가 쓰는 형식과 똑같다.
- **Mac 잠자기**: 긴 작업은 `caffeinate -i`로 돌린다. 잠자기 중 DNS가 끊겨 수집이 깨진 적이 있다.
- 실험용 모델 설정(`lab-models.json5`)은 레포의 에이전트 프로필에 넣지 않는다. `lab.sh agents`가 실행용 미러(`~/.ambient-a2a/app`)에만 추가한다.
