#!/usr/bin/env bash
# Start Home Assistant + the five OpenClaw agent gateways. Ctrl-C stops the gateways (HA keeps running).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$ROOT/.env" ] || { echo "copy .env.example to .env first" >&2; exit 1; }
docker compose -f "$ROOT/homeassistant/docker-compose.yml" up -d
mkdir -p "$ROOT/logs"
pids=()
for id in desktop smartphone orchestrator room1 room2; do
  "$ROOT/scripts/oc.sh" "$id" gateway > "$ROOT/logs/$id.log" 2>&1 &
  pids+=($!)
  echo "started $id (pid $!, log logs/$id.log)"
done
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
echo "HA dashboard: http://127.0.0.1:8123/ambient-home   event log: scripts/logs.sh"
wait
