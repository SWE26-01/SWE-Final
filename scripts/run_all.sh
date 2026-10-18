#!/usr/bin/env bash
# Start Home Assistant + the five OpenClaw agent gateways. Ctrl-C stops the gateways (HA keeps running).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$ROOT/.env" ] || { echo "run scripts/setup.sh first" >&2; exit 1; }
set -a; . "$ROOT/.env"; set +a
export AMBIENT_ENV_LOADED=1 # oc.sh must not reload .env over the settings below
[ -n "${HA_TOKEN:-}" ] || { echo "HA_TOKEN missing in .env (scripts/setup.sh creates it)" >&2; exit 1; }
[ -n "${OPENROUTER_API_KEY:-}" ] || echo "warning: OPENROUTER_API_KEY empty — A2A works, but agents can't answer natural-language messages" >&2

docker compose -f "$ROOT/homeassistant/docker-compose.yml" up -d

# SWE-Final: also run the Device Gateway and Event Collector (services/) and point the agents at them.
# A2A-agents on its own has no services/ and is unaffected. AMBIENT_SERVICES=off skips this.
services=""
if [ -f "$ROOT/services/docker-compose.yml" ] && [ "${AMBIENT_SERVICES:-on}" != off ]; then
  export AMBIENT_GATEWAY_URL=${AMBIENT_GATEWAY_URL:-http://127.0.0.1:8100}
  export AMBIENT_COLLECTOR_URL=${AMBIENT_COLLECTOR_URL:-http://127.0.0.1:8200}
  docker compose -f "$ROOT/services/docker-compose.yml" up -d --build --quiet-pull 2>&1 | grep -v -e '^ *#' -e '^ *=>' || true
  for _ in $(seq 1 30); do
    curl -fs -o /dev/null "$AMBIENT_GATEWAY_URL/health" && curl -fs -o /dev/null "$AMBIENT_COLLECTOR_URL/health" && services=up && break
    sleep 1
  done
  if [ -z "$services" ]; then
    echo "warning: Gateway/Collector not up (see: docker compose -f services/docker-compose.yml logs) — agents use HA directly" >&2
    unset AMBIENT_GATEWAY_URL AMBIENT_COLLECTOR_URL
  fi
fi
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
if [ -n "$services" ]; then cat <<EOF
Gateway        $AMBIENT_GATEWAY_URL   (agents reach HA through it)
Collector      $AMBIENT_COLLECTOR_URL   (all agents' events)
Ctrl-C leaves HA, Gateway and Collector running.
EOF
fi
wait
