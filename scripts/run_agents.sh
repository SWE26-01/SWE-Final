#!/usr/bin/env bash
# Start the five OpenClaw agent gateways in the foreground (the `agents` container runs this).
# Each agent's output goes to logs/<id>.log and, prefixed, to stdout. Runs until all of them exit
# (scripts/scenario.sh --kill-home stops only the orchestrator).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$ROOT/logs"
"$ROOT/scripts/oc.sh" desktop --version >/dev/null # mirror agents/ once before parallel starts
for id in desktop smartphone orchestrator room1 room2; do
  (AMBIENT_SKIP_SYNC=1 "$ROOT/scripts/oc.sh" "$id" gateway 2>&1 | tee "$ROOT/logs/$id.log" | sed -u "s/^/[$id] /") &
done
wait
