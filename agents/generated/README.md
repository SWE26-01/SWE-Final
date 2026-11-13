# Agents made in Studio

Studio (`services/studio`) writes one folder here for each draft the user approves:
`<agent id>/openclaw.json5` and `<agent id>/AGENTS.md`, in the same shape as `../internel/room1`.
The folders are local to this home and not committed (`.gitignore`).

Run one like a platform agent: `scripts/oc.sh <agent id> gateway`.
Before it can talk to the other agents, it still needs its token (`AMBIENT_TOKEN_<ID>`, issued by the
Agent Hub when the user connects it) and an entry in `../shared.json5` (`peers`, `tokens`);
see `services/README.md`, "Agent Hub and Studio".
