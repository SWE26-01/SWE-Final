#!/usr/bin/env bash
# One-time setup. Safe to re-run; finished steps are skipped.
#   scripts/setup.sh           .env with fresh tokens: enough for `docker compose up`
#   scripts/setup.sh --local   + Node 24, OpenClaw, plugin deps and the a2a-sdk probe venv, to run
#                              agents on this machine (scripts/oc.sh) and scripts/scenario.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OPENCLAW_VERSION=2026.10.4
say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

say ".env"
ENV=$ROOT/.env
[ -f "$ENV" ] || cp "$ROOT/.env.example" "$ENV"
# Names changed on 2026-11-22 (AMBIENT_* -> AGENT_*, orchestrator -> root): keep the old values.
while read -r old new; do
  if grep -q "^$old=" "$ENV" && ! grep -q "^$new=" "$ENV"; then
    O=$old N=$new perl -pi -e 's/^\Q$ENV{O}\E=/$ENV{N}=/' "$ENV"
  fi
done <<'RENAMES'
AMBIENT_TOKEN_ORCHESTRATOR AGENT_TOKEN_ROOT
AMBIENT_TOKEN_DESKTOP AGENT_TOKEN_DESKTOP
AMBIENT_TOKEN_SMARTPHONE AGENT_TOKEN_SMARTPHONE
AMBIENT_TOKEN_ROOM1 AGENT_TOKEN_ROOM1
AMBIENT_TOKEN_ROOM2 AGENT_TOKEN_ROOM2
AMBIENT_MODEL AGENT_MODEL
AMBIENT_GATEWAY_URL DEVICE_GATEWAY_URL
AMBIENT_COLLECTOR_URL EVENT_COLLECTOR_URL
AMBIENT_CORS_ORIGINS CORS_ORIGINS
AMBIENT_HOME AGENT_HOME
AMBIENT_TOKEN_PROBE AGENT_TOKEN_PROBE
RENAMES
# Keys added to .env.example after this .env was made.
grep -E '^[A-Z0-9_]+=' "$ROOT/.env.example" | while IFS= read -r line; do
  grep -q "^${line%%=*}=" "$ENV" || echo "$line" >> "$ENV"
done
for k in $(grep -oE '^[A-Z0-9_]+=change-me' "$ENV" | cut -d= -f1); do
  K=$k V=$(openssl rand -hex 24) perl -pi -e 's/^\Q$ENV{K}\E=.*$/$ENV{K}=$ENV{V}/' "$ENV"
done

if [ "${1:-}" = --local ]; then
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
  (cd "$ROOT/agents/home-a2a-plugin" && pnpm install --frozen-lockfile --silent)

  say "python venv for the a2a-sdk probe"
  [ -x "$ROOT/.venv/bin/python" ] || python3 -m venv "$ROOT/.venv"
  "$ROOT/.venv/bin/pip" install -q -r "$ROOT/scripts/requirements.txt"
fi

say "done"
if grep -q '^OPENROUTER_API_KEY=$' "$ENV"; then
  echo "→ put your key in .env: OPENROUTER_API_KEY=sk-or-..."
fi
echo "→ then: scripts/run_all.sh   (or: docker compose up -d --build)"
