#!/usr/bin/env bash
# Start everything (docker-compose.yml) and wait until each part answers.
# It keeps running in Docker: `docker compose logs -f agents` follows the agents,
# `docker compose down` stops it all.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$ROOT/.env" ] || { echo "run scripts/setup.sh first" >&2; exit 1; }
set -a; . "$ROOT/.env"; set +a
[ -n "${OPENROUTER_API_KEY:-}" ] || echo "warning: OPENROUTER_API_KEY empty — A2A works, but agents can't answer natural-language messages and Studio needs STUDIO_LLM=rules" >&2

mkdir -p "$ROOT/logs" "$ROOT/agents/generated"
(cd "$ROOT" && docker compose up -d --build --quiet-pull 2>&1 | grep -v -e '^ *#' -e '^ *=>' || true)

wait_for() { # name url
  printf '%-13s' "$1"
  for _ in $(seq 1 180); do  # agents may wait out OpenClaw's 90 s gateway lock (run_agents.sh)
    curl -fs -o /dev/null "$2" && { echo up; return; }
    sleep 1
  done
  echo "NOT UP — see: docker compose logs $3"
}
wait_for gateway http://127.0.0.1:8100/health gateway
wait_for collector http://127.0.0.1:8200/health collector
wait_for hub http://127.0.0.1:8400/health hub
wait_for studio http://127.0.0.1:8500/health studio
wait_for cloud-web http://127.0.0.1:3000/login cloud-web
wait_for home-web http://127.0.0.1:3001/login home-web
for a in desktop:18800 smartphone:18920 root:19040 room1:19160 room2:19280 kitchen:18680; do
  wait_for "${a%%:*}" "http://127.0.0.1:${a#*:}/plugins/a2a/.well-known/agent-card.json" agents
done

cat <<EOF

Agent Cloud    http://127.0.0.1:3000          smart home app  http://127.0.0.1:3001
Agent Hub      http://127.0.0.1:8400/docs     Studio  http://127.0.0.1:8500/docs
Gateway        http://127.0.0.1:8100/devices  (virtual home; Bearer \$DASHBOARD_TOKEN)
event log      scripts/logs.sh
checks         scripts/scenario.sh [--llm] [--kill-home]   (needs scripts/setup.sh --local)
talk           scripts/say.sh desktop "나 회의 시작할게"
stop           docker compose down
EOF
