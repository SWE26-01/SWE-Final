#!/usr/bin/env bash
# Create labels and one issue per WBS row. Requires: gh auth login, run inside the repo.
# Usage: scripts/create_issues.sh            (dry run, prints commands)
#        scripts/create_issues.sh --apply    (creates labels and issues)
set -euo pipefail
cd "$(dirname "$0")/.."
run() { if [[ "${1:-}" == "--apply-mode" ]]; then shift; "$@"; else echo "$*"; fi; }
mode=""; [[ "${1:-}" == "--apply" ]] && mode="--apply-mode"

for label in P0 P1 infra ambient agent gateway dashboard test docs; do
  run $mode gh label create "$label" --force
done

tail -n +2 scripts/wbs_issues.tsv | while IFS=$'\t' read -r id prio area title done_when; do
  body=$'**WBS ID**: '"$id"$'\n\n**완료 기준**: '"$done_when"$'\n\n**우선순위**: '"$prio"
  run $mode gh issue create --title "[$id] $title" --label "$prio" --label "$area" --body "$body"
done
