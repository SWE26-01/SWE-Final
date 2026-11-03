#!/usr/bin/env bash
# One-time setup: Python venv for the helpers, .env with fresh tokens,
# Home Assistant container + long-lived token. Safe to re-run; finished steps are skipped.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
say() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }

say "python venv for the HA token helper"
[ -x "$ROOT/.venv/bin/python" ] || python3 -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/pip" install -q -r "$ROOT/scripts/requirements.txt"

ENV=$ROOT/.env
setenv() { # key value — replace KEY=... in .env
  "$ROOT/.venv/bin/python" -c 'import re,sys;p,k,v=sys.argv[1:];s=open(p).read();open(p,"w").write(re.sub(rf"(?m)^{k}=.*$",lambda _:f"{k}={v}",s))' "$ENV" "$1" "$2"
}
[ -f "$ENV" ] || cp "$ROOT/.env.example" "$ENV"
for k in $(grep -oE '^[A-Z0-9_]+' "$ROOT/.env.example"); do # keys added since this .env was made
  grep -q "^$k=" "$ENV" || { [ -z "$(tail -c1 "$ENV")" ] || echo >> "$ENV"; grep "^$k=" "$ROOT/.env.example" >> "$ENV"; }
done
for k in $(grep -oE '^[A-Z0-9_]+=change-me' "$ENV" | cut -d= -f1); do setenv "$k" "$(openssl rand -hex 24)"; done
set -a; . "$ENV"; set +a

say "Home Assistant"
docker compose -f "$ROOT/homeassistant/docker-compose.yml" up -d
HA=${HA_URL:-http://127.0.0.1:8123}
# Any HTTP answer means HA is up (/api/onboarding disappears once onboarding is done, so don't wait on it).
printf 'waiting for HA'; until curl -s -o /dev/null "$HA/"; do printf .; sleep 3; done; echo
if [ -z "${HA_TOKEN:-}" ]; then
  until curl -fs -o /dev/null "$HA/api/onboarding"; do sleep 3; done
  pw=$(openssl rand -hex 12)
  setenv HA_TOKEN "$("$ROOT/.venv/bin/python" "$ROOT/scripts/ha_token.py" "$HA" "$pw")"
  setenv HA_ADMIN_PASSWORD "$pw"
  echo "HA login: admin / $pw (saved in .env)"
fi

say "done"
echo "→ then: scripts/run_all.sh"
