#!/usr/bin/env bash
# Live Ambient-A2A event log: time agent direction peer type verdict reason message
ROOT=$(cd "$(dirname "$0")/.." && pwd)
touch "$ROOT/logs/events.jsonl"
tail -n "${1:-30}" -F "$ROOT/logs/events.jsonl" | jq -r --unbuffered '
  [ .ts[11:19], .agent, .dir, (.from // .to // "-"), (.type // .rule // "-"),
    (if .accepted == true then "✔" elif .accepted == false then "✘" else " " end),
    (.reason_code // ""), ((.action | if . then "\(.command) \(.device // "")" else empty end) // ""), (.message // .error // "") ]
  | @tsv'
