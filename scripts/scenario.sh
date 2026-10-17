#!/usr/bin/env bash
# plan.md 8.3 checks against running agents (scripts/run_all.sh). Watch scripts/logs.sh + the HA dashboard alongside.
#   scripts/scenario.sh              deterministic checks via the standard a2a-sdk client
#   scripts/scenario.sh --llm        + natural-language flows through OpenClaw (needs a model key)
#   scripts/scenario.sh --kill-home  + stop the orchestrator and show room1 keeps working
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
set -a; . "${ENV_FILE:-$ROOT/.env}"; set +a
PY=${PYTHON:-$ROOT/.venv/bin/python}
HA=${HA_URL:-http://127.0.0.1:8123}
probe() { "$PY" "$ROOT/scripts/a2a_probe.py" "$@"; }
step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ha() { curl -fsS -X POST -H "Authorization: Bearer $HA_TOKEN" -H 'content-type: application/json' "$HA/api/services/input_boolean/$2" -d "{\"entity_id\":\"input_boolean.$1\"}" >/dev/null; }
ha_state() { curl -fsS -H "Authorization: Bearer $HA_TOKEN" "$HA/api/states/$1" | jq -r .state; }
iso() { "$PY" -c "import datetime as d,sys;print((d.datetime.now(d.timezone.utc)+d.timedelta(hours=float(sys.argv[1]))).isoformat())" "$1"; }
update() { # seq expires_offset_hours meeting_bool
  echo "{\"type\":\"context.update\",\"source\":\"desktop\",\"subject\":\"user1\",\"sequence\":$1,\"expires_at\":\"$(iso "$2")\",\"data\":{\"meeting_app_active\":$3}}"
}
SEQ=$(date +%s) # monotonically above anything sent by earlier runs

step "8. interop: a2a-sdk resolves every Agent Card + Ambient-A2A extension"
probe cards

step "A. desktop → home → room1: light meeting mode (home checks ACL, delegates; room1 decides)"
probe send orchestrator desktop '{"type":"device.control","request_id":"scn-A1","action":{"device":"input_select.room1_light_mode","command":"SET","value":"meeting"}}'
step "A. desktop → home: mute living-room TV (home-owned)"
probe send orchestrator desktop '{"type":"device.control","request_id":"scn-A2","action":{"device":"input_boolean.living_tv_muted","command":"TURN_ON"}}'
step "1-1. home rejects an unauthorized request before it reaches room2"
probe send orchestrator desktop '{"type":"device.control","request_id":"scn-A3","action":{"device":"input_boolean.room2_ac","command":"TURN_OFF"}}' || true

step "B. home queries desktop context — pc_state is not shared with home"
probe send desktop orchestrator '{"type":"context.query","subject":"user1","fields":["meeting_app_active","pc_state"]}'
step "3. unknown bearer token is rejected"
probe send desktop bad '{"type":"context.query","fields":["pc_state"]}' || true

step "4. context freshness at room1: fresh → accepted, older sequence → STALE, expired → STALE"
probe send room1 desktop "$(update "$SEQ" 1 false)"
probe send room1 desktop "$(update $((SEQ - 1)) 1 true)" || true
probe send room1 desktop "$(update $((SEQ + 1)) -1 true)" || true

step "5. ownership: room1 refuses a device it does not own"
probe send room1 orchestrator '{"type":"device.control","request_id":"scn-5","action":{"device":"input_boolean.living_tv","command":"TURN_OFF"}}' || true

step "6. energy saving with room2 asleep: room1 complies, room2 keeps AC on (SAFETY_POLICY), home aggregates"
ha room2_sleep_mode turn_on; ha room2_ac turn_on; ha room1_light turn_on; ha room1_ac turn_on
probe send orchestrator smartphone '{"type":"device.control","request_id":"scn-6","action":{"command":"ENERGY_SAVING"},"reason_code":"ENERGY_SAVING"}'
echo "room1_ac=$(ha_state input_boolean.room1_ac) room2_ac=$(ha_state input_boolean.room2_ac)"

for arg in "$@"; do case $arg in
  --llm)
    step "LLM A. desktop: \"나 회의 시작할게\""
    "$ROOT/scripts/oc.sh" desktop agent --agent main --message "나 회의 시작할게"
    step "LLM B. orchestrator: checks external context before whole-home energy saving"
    "$ROOT/scripts/oc.sh" orchestrator agent --agent main --message "지금 집 전체 절전해도 될까? 데스크탑과 폰 상태를 먼저 확인하고 판단해줘."
    ;;
  --kill-home)
    step "7. orchestrator down → room1 still reacts to desktop context on its own"
    lsof -ti tcp:19040 | xargs kill 2>/dev/null || true
    sleep 1
    probe send room1 desktop "$(update $((SEQ + 2)) 1 true)"
    sleep 1
    echo "room1_light_mode=$(ha_state input_select.room1_light_mode) (expect meeting); restart home with: scripts/oc.sh orchestrator gateway"
    ;;
esac; done
