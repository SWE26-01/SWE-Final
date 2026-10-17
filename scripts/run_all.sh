#!/usr/bin/env bash
# Start Home Assistant + the five OpenClaw agent gateways. Ctrl-C stops the gateways (HA keeps running).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$ROOT/.env" ] || { echo "run scripts/setup.sh first" >&2; exit 1; }
set -a; . "$ROOT/.env"; set +a
[ -n "${HA_TOKEN:-}" ] || { echo "HA_TOKEN missing in .env (scripts/setup.sh creates it)" >&2; exit 1; }
[ -n "${OPENROUTER_API_KEY:-}" ] || echo "warning: OPENROUTER_API_KEY empty — A2A works, but agents can't answer natural-language messages" >&2

docker compose -f "$ROOT/homeassistant/docker-compose.yml" up -d
mkdir -p "$ROOT/logs"
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
"$ROOT/scripts/oc.sh" desktop --version >/dev/null # mirror agents/ once before parallel starts
for id in desktop smartphone orchestrator room1 room2; do
  AMBIENT_SKIP_SYNC=1 "$ROOT/scripts/oc.sh" "$id" gateway > "$ROOT/logs/$id.log" 2>&1 &
  pids+=($!)
done

port() { case $1 in desktop) echo 18800;; smartphone) echo 18920;; orchestrator) echo 19040;; room1) echo 19160;; room2) echo 19280;; esac; }
for id in desktop smartphone orchestrator room1 room2; do
  printf '%-13s' "$id"
  for _ in $(seq 1 60); do
    curl -fs -o /dev/null "http://127.0.0.1:$(port "$id")/plugins/ambient/.well-known/agent-card.json" && { echo "up  (log: logs/$id.log)"; continue 2; }
    sleep 1
  done
  echo "NOT UP — see logs/$id.log"
done

cat <<EOF

HA dashboard   ${HA_URL:-http://127.0.0.1:8123}/ambient-home   (admin / ${HA_ADMIN_PASSWORD:-see .env})
event log      scripts/logs.sh
checks         scripts/scenario.sh [--llm] [--kill-home]
talk           scripts/oc.sh desktop agent --agent main --message "나 회의 시작할게"
Ctrl-C stops the agents.
EOF
wait
