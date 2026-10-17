#!/usr/bin/env bash
# Run openclaw against one Ambient-A2A agent profile.
#   scripts/oc.sh room1 gateway                       # start that agent's gateway (foreground)
#   scripts/oc.sh desktop agent --agent main --message "나 회의 시작할게"
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
id=${1:?usage: oc.sh <desktop|smartphone|orchestrator|room1|room2> <openclaw args...>}; shift
case $id in
  desktop|smartphone) dir=externel/$id ;;
  orchestrator|room1|room2) dir=internel/$id ;;
  *) echo "unknown agent: $id" >&2; exit 1 ;;
esac
[ -f "$ROOT/.env" ] && { set -a; . "$ROOT/.env"; set +a; }
# OpenClaw needs Node >=24.16; switch via nvm when the shell's node is older.
if ! node -v 2>/dev/null | grep -qE '^v(2[4-9]|[3-9][0-9])\.'; then
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm use 24 >/dev/null
fi
# OpenClaw's file guards reject non-ASCII (NFD) paths like this repo's "소웨공", so configs + plugin
# run from an ASCII mirror. ponytail: rsync on every call; run_all.sh syncs once and sets AMBIENT_SKIP_SYNC.
export AMBIENT_HOME=${AMBIENT_HOME:-$HOME/.ambient-a2a}
app=$AMBIENT_HOME/app
[ -n "${AMBIENT_SKIP_SYNC:-}" ] || { mkdir -p "$app"; rsync -a --delete "$ROOT/agents" "$app/"; }
export AMBIENT_ROOT=$ROOT OPENCLAW_INCLUDE_ROOTS=$app/agents OPENCLAW_ALLOW_MULTI_GATEWAY=1
state=$AMBIENT_HOME/state/$id
mkdir -p "$state/workspace"
# OpenClaw rewrites its active config file, so point it at a stub that includes the mirrored config.
printf '{ "$include": "%s" }\n' "$app/agents/$dir/openclaw.json5" > "$state/openclaw.json"
cp "$ROOT/agents/$dir/AGENTS.md" "$state/workspace/AGENTS.md"
export OPENCLAW_CONFIG_PATH=$state/openclaw.json OPENCLAW_STATE_DIR=$state
exec openclaw "$@"
