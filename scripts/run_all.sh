#!/usr/bin/env bash
# Start Home Assistant and the services (Device Gateway, Event Collector) in Docker; they keep running.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$ROOT/.env" ] || { echo "run scripts/setup.sh first" >&2; exit 1; }
set -a; . "$ROOT/.env"; set +a
[ -n "${HA_TOKEN:-}" ] || { echo "HA_TOKEN missing in .env (scripts/setup.sh creates it)" >&2; exit 1; }

docker compose -f "$ROOT/homeassistant/docker-compose.yml" up -d
docker compose -f "$ROOT/services/docker-compose.yml" up -d --build --quiet-pull 2>&1 | grep -v -e '^ *#' -e '^ *=>' || true

for svc in gateway:8100 collector:8200; do
  printf '%-11s' "${svc%%:*}"
  for _ in $(seq 1 30); do
    curl -fs -o /dev/null "http://127.0.0.1:${svc##*:}/health" && { echo "up  http://127.0.0.1:${svc##*:}"; continue 2; }
    sleep 1
  done
  echo "NOT UP — docker compose -f services/docker-compose.yml logs ${svc%%:*}"
done

cat <<EOF

HA dashboard   ${HA_URL:-http://127.0.0.1:8123}/ambient-home   (admin / ${HA_ADMIN_PASSWORD:-see .env})
stop           docker compose -f services/docker-compose.yml down; docker compose -f homeassistant/docker-compose.yml down
EOF
