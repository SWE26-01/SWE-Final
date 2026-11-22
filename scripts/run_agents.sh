#!/usr/bin/env bash
# Start the six OpenClaw agent gateways in the foreground (the `agents` container runs this), and
# the launcher that starts the agents made in Studio when the user connects them in the Agent Hub.
# Each agent's output goes to logs/<id>.log and, prefixed, to stdout. Runs until all of them exit
# (scripts/scenario.sh --kill-home stops only the root).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$ROOT/logs"
"$ROOT/scripts/oc.sh" desktop --version >/dev/null # mirror agents/ once before parallel starts
# A gateway that fails while starting is tried again for up to 3 minutes: when this container is
# recreated (compose up --build, down/up), OpenClaw refuses to start until the previous container's
# gateway lock in /state is 90 s old (GatewayLockNamespaceError). One that stops later
# (scripts/scenario.sh --kill-home) stays down.
run() {
  local first=$SECONDS started
  while :; do
    started=$SECONDS
    AGENT_SKIP_SYNC=1 "$ROOT/scripts/oc.sh" "$1" gateway && return
    ((SECONDS - started > 60 || SECONDS - first > 180)) && return
    echo "failed while starting; trying again in 10 s"; sleep 10
  done
}
# Each OpenClaw gateway takes about 1 GB (not the LLM: that is OpenRouter). Six of them need Docker
# Desktop's memory raised to 10 GB or more; with the default ~7.7 GB one may be killed (OOM).
for id in desktop smartphone root room1 room2 kitchen; do
  (run "$id" 2>&1 | tee "$ROOT/logs/$id.log" | sed -u "s/^/[$id] /") &
done
node "$ROOT/scripts/launcher.mjs" &
wait
