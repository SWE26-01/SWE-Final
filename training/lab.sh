#!/usr/bin/env bash
# Lab helpers for DPO data collection / evaluation. HA, Gateway and Collector must already be up
# (scripts/run_all.sh in the main checkout, or docker compose there).
#
#   training/lab.sh setup             # venvs under ~/.ambient-a2a/venvs (once)
#   training/lab.sh serve [gguf] [port]  # llama-server for EXAONE (default: base model on :8090)
#   training/lab.sh proxy             # logging proxy on :8300
#   training/lab.sh agents <model>    # restart the 5 agent gateways on lab/<model> (haiku|exaone|exaone-dpo|…)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
HOMEDIR=$HOME/.ambient-a2a
V=$HOMEDIR/venvs
MODELS=$HOMEDIR/models

case ${1:?usage: lab.sh setup|serve|proxy|agents} in
setup)
  [ -x "$V/lab/bin/python" ] || uv venv -q -p 3.13 "$V/lab"
  VIRTUAL_ENV=$V/lab uv pip install -q httpx starlette uvicorn
  [ -x "$V/trl/bin/python" ] || uv venv -q -p 3.13 "$V/trl"
  VIRTUAL_ENV=$V/trl uv pip install -q "trl==1.16.0" "peft>=0.17" "transformers>=4.56" "accelerate>=1.10" "datasets>=4.0" torch
  mkdir -p "$MODELS"
  [ -f "$MODELS/EXAONE-4.0-1.2B-Q8_0.gguf" ] || curl -sL -o "$MODELS/EXAONE-4.0-1.2B-Q8_0.gguf" \
    https://huggingface.co/LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF/resolve/main/EXAONE-4.0-1.2B-Q8_0.gguf
  command -v llama-server >/dev/null || brew install llama.cpp
  ;;
serve)
  # The official EXAONE 4.0 template uses {% continue %}, which llama.cpp's template engine drops (tools and the
  # system prompt vanish). exaone4-chat_template.jinja is the same template without it.
  exec llama-server -m "${2:-$MODELS/EXAONE-4.0-1.2B-Q8_0.gguf}" --jinja \
    --chat-template-file "$ROOT/training/exaone4-chat_template.jinja" \
    --host 127.0.0.1 --port "${3:-8090}" -c 32768 --alias exaone
  ;;
proxy)
  set -a; . "$ROOT/.env"; set +a
  exec "$V/lab/bin/python" "$ROOT/training/proxy.py"
  ;;
agents)
  M=${2:?model, e.g. haiku}
  pkill -f openclaw-gateway || true
  for _ in $(seq 1 60); do pgrep -f openclaw-gateway >/dev/null || break; sleep 1; done
  set -a; . "$ROOT/.env"; set +a
  export AMBIENT_ENV_LOADED=1 AMBIENT_MODEL=lab/$M
  export AMBIENT_GATEWAY_URL=${AMBIENT_GATEWAY_URL:-http://127.0.0.1:8100} AMBIENT_COLLECTOR_URL=${AMBIENT_COLLECTOR_URL:-http://127.0.0.1:8200}
  "$ROOT/scripts/oc.sh" desktop --version >/dev/null   # sync agents/ into the ASCII mirror
  app=$HOMEDIR/app/agents
  cp "$ROOT/training/lab-models.json5" "$app/lab-models.json5"
  for f in "$app"/externel/*/openclaw.json5 "$app"/internel/*/openclaw.json5; do
    grep -q lab-models "$f" || sed -i '' 's|^  tools: { profile|  models: { $include: "../../lab-models.json5" },\n  tools: { profile|' "$f"
  done
  mkdir -p "$ROOT/logs"
  for id in desktop smartphone orchestrator room1 room2; do
    AMBIENT_SKIP_SYNC=1 nohup "$ROOT/scripts/oc.sh" "$id" gateway > "$ROOT/logs/$id.log" 2>&1 &
  done
  for p in 18800 18920 19040 19160 19280; do
    for _ in $(seq 1 90); do curl -fs -o /dev/null "http://127.0.0.1:$p/plugins/ambient/.well-known/agent-card.json" && break; sleep 1; done
  done
  grep -h "agent model" "$ROOT/logs/desktop.log" | sed 's/\x1b\[[0-9;]*m//g' | tail -1 | grep -o 'agent model: [^ ]*'
  ;;
*) echo "unknown command $1" >&2; exit 2 ;;
esac
