#!/usr/bin/env bash
# Run openclaw against one agent profile.
#   scripts/oc.sh room1 gateway                       # start that agent's gateway (foreground)
#   scripts/oc.sh desktop agent --agent main --message "나 회의 시작할게"
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
id=${1:?usage: oc.sh <desktop|smartphone|root|room1|room2|kitchen|generated id> <openclaw args...>}; shift
case $id in
  desktop|smartphone) dir=external/$id ;;
  root|room1|room2|kitchen) dir=internal/$id ;;
  *) # an agent made in Studio (services/studio), approved into agents/generated/<id>/
     [[ $id =~ ^[a-z0-9][a-z0-9_-]*$ && -f "$ROOT/agents/generated/$id/openclaw.json5" ]] \
       || { echo "unknown agent: $id" >&2; exit 1; }
     dir=generated/$id ;;
esac
# run_all.sh loads .env itself and may adjust it (services URLs); keep what it passes down.
[ -z "${AGENT_ENV_LOADED:-}" ] && [ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
# OpenClaw needs Node >=24.16; switch via nvm when the shell's node is older.
if ! node -v 2>/dev/null | grep -qE '^v(2[4-9]|[3-9][0-9])\.'; then
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm use 24 >/dev/null
fi
# OpenClaw's file guards reject non-ASCII (NFD) paths like this repo's "소웨공", so configs + plugin
# run from an ASCII mirror. ponytail: rsync on every call; run_all.sh syncs once and sets AGENT_SKIP_SYNC.
export AGENT_HOME=${AGENT_HOME:-$HOME/.home-a2a}
app=$AGENT_HOME/app
[ -n "${AGENT_SKIP_SYNC:-}" ] || { mkdir -p "$app"; rsync -a --delete "$ROOT/agents" "$app/"; }
export AGENTS_ROOT=$ROOT OPENCLAW_INCLUDE_ROOTS=$app/agents OPENCLAW_ALLOW_MULTI_GATEWAY=1
state=$AGENT_HOME/state/$id
mkdir -p "$state/workspace"
# An agent made in Studio: its Hub-issued token, saved by scripts/launcher.mjs when the user connected it.
if [ -z "${AGENT_SELF_TOKEN:-}" ] && [ -f "$state/agent-token" ]; then
  AGENT_SELF_TOKEN=$(cat "$state/agent-token"); export AGENT_SELF_TOKEN
fi
# OpenClaw rewrites its active config file, so point it at a stub that includes the mirrored config.
printf '{ "$include": "%s" }\n' "$app/agents/$dir/openclaw.json5" > "$state/openclaw.json"
cp "$ROOT/agents/$dir/AGENTS.md" "$state/workspace/AGENTS.md"
export OPENCLAW_CONFIG_PATH=$state/openclaw.json OPENCLAW_STATE_DIR=$state
# exec keeps the pid: scripts/scenario.sh --kill-home stops one agent with it.
[ "${1:-}" = gateway ] && echo $$ > "$state/gateway.pid"
exec openclaw "$@"
