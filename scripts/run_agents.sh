#!/usr/bin/env bash
# Start the five OpenClaw agent gateways in the foreground (the `agents` container runs this), and
# the launcher that starts the agents made in Studio when the user connects them in the Agent Hub.
# Each agent's output goes to logs/<id>.log and, prefixed, to stdout. Runs until all of them exit
# (scripts/scenario.sh --kill-home stops only the orchestrator).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$ROOT/logs"
"$ROOT/scripts/oc.sh" desktop --version >/dev/null # mirror agents/ once before parallel starts
# A gateway that fails while starting (cold start while the whole stack builds) gets two more tries;
# one that stops later (scripts/scenario.sh --kill-home) stays down.
run() {
  local attempt started
  for attempt in 1 2 3; do
    started=$SECONDS
    AMBIENT_SKIP_SYNC=1 "$ROOT/scripts/oc.sh" "$1" gateway && return
    ((SECONDS - started > 60)) && return
    echo "failed while starting (try $attempt of 3)"; sleep 3
  done
}
for id in desktop smartphone orchestrator room1 room2; do
  (run "$id" 2>&1 | tee "$ROOT/logs/$id.log" | sed -u "s/^/[$id] /") &
done
node "$ROOT/scripts/launcher.mjs" &
wait
