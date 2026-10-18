#!/usr/bin/env bash
# Send one message to a running agent over its gateway's HTTP API (fast path; no CLI cold start).
#   scripts/say.sh desktop "나 회의 시작할게"
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -a; . "$ROOT/.env"; set +a
case ${1:?agent} in desktop) p=18800;; smartphone) p=18920;; orchestrator) p=19040;; room1) p=19160;; room2) p=19280;; *) echo "unknown agent: $1" >&2; exit 1;; esac
body=$(jq -n --arg m "${2:?message}" --arg u "conv:${SAY_SESSION:-demo}" '{model:"openclaw", user:$u, messages:[{role:"user", content:$m}]}')
res=$(curl -fsS --max-time 300 "http://127.0.0.1:$p/v1/chat/completions" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" -H 'content-type: application/json' -d "$body")
if [ -n "${SAY_RAW:-}" ]; then echo "$res"; else echo "$res" | jq -r '.choices[0].message.content'; fi
