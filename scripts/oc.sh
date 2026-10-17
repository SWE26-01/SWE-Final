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
export AMBIENT_ROOT=$ROOT OPENCLAW_INCLUDE_ROOTS=$ROOT/agents OPENCLAW_ALLOW_MULTI_GATEWAY=1
state=$ROOT/.state/$id
mkdir -p "$state/workspace"
# OpenClaw rewrites its active config file, so point it at a stub that includes the repo config.
[ -f "$state/openclaw.json" ] || printf '{ "$include": "%s" }\n' "$ROOT/agents/$dir/openclaw.json5" > "$state/openclaw.json"
cp "$ROOT/agents/$dir/AGENTS.md" "$state/workspace/AGENTS.md"
export OPENCLAW_CONFIG_PATH=$state/openclaw.json OPENCLAW_STATE_DIR=$state
exec openclaw "$@"
