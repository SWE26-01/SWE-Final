#!/usr/bin/env bash
# One-time setup: Node 24 + OpenClaw, plugin deps, Python probe venv, .env with fresh tokens,
# Home Assistant container + long-lived token. Safe to re-run; finished steps are skipped.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OPENCLAW_VERSION=2026.10.4
say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

say "Node 24 (OpenClaw needs >=24.16)"
export NVM_DIR=${NVM_DIR:-$HOME/.nvm}
[ -s "$NVM_DIR/nvm.sh" ] || { echo "nvm not found at $NVM_DIR — install Node 24.16+ manually" >&2; exit 1; }
. "$NVM_DIR/nvm.sh"
nvm install 24 >/dev/null && nvm use 24 >/dev/null
node -v

say "OpenClaw $OPENCLAW_VERSION"
[ "$(openclaw --version 2>/dev/null | grep -o '[0-9.]*' | head -1)" = "$OPENCLAW_VERSION" ] || npm i -g "openclaw@$OPENCLAW_VERSION"
command -v pnpm >/dev/null || npm i -g pnpm

say "plugin dependencies"
(cd "$ROOT/agents/ambient-a2a-plugin" && pnpm install --frozen-lockfile --silent)

say "python venv for the a2a-sdk probe"
[ -x "$ROOT/.venv/bin/python" ] || python3 -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/pip" install -q -r "$ROOT/scripts/requirements.txt"

ENV=$ROOT/.env
setenv() { # key value — replace KEY=... in .env
  "$ROOT/.venv/bin/python" -c 'import re,sys;p,k,v=sys.argv[1:];s=open(p).read();open(p,"w").write(re.sub(rf"(?m)^{k}=.*$",lambda _:f"{k}={v}",s))' "$ENV" "$1" "$2"
}
[ -f "$ENV" ] || cp "$ROOT/.env.example" "$ENV"
for k in $(grep -oE '^[A-Z0-9_]+=change-me' "$ENV" | cut -d= -f1); do setenv "$k" "$(openssl rand -hex 24)"; done
set -a; . "$ENV"; set +a

say "Home Assistant"
docker compose -f "$ROOT/homeassistant/docker-compose.yml" up -d
HA=${HA_URL:-http://127.0.0.1:8123}
printf 'waiting for HA'; until curl -fs -o /dev/null "$HA/api/onboarding"; do printf .; sleep 3; done; echo
if [ -z "${HA_TOKEN:-}" ]; then
  pw=$(openssl rand -hex 12)
  setenv HA_TOKEN "$("$ROOT/.venv/bin/python" "$ROOT/scripts/ha_token.py" "$HA" "$pw")"
  setenv HA_ADMIN_PASSWORD "$pw"
  echo "HA login: admin / $pw (saved in .env)"
fi

say "done"
if grep -q '^OPENROUTER_API_KEY=$' "$ENV"; then
  echo "→ put your key in .env: OPENROUTER_API_KEY=sk-or-..."
fi
echo "→ then: scripts/run_all.sh"
