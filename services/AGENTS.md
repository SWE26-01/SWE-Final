Read `docs/HANDOFF.md` first for project context and decisions.

# Rules for AI coding tools (Claude Code, Copilot, Cursor …)

This repo is the Device Gateway and the Event Collector for the agents in SWE26-01/A2A-agents
(OpenClaw). Do not add agent logic here; agents, the Ambient-A2A spec and Home Assistant config
live in that repo. See `docs/integration.md`.

- Agent IDs (`desktop`, `smartphone`, `orchestrator`, `room1`, `room2`) and device IDs (Home Assistant
  entity ids) follow A2A-agents. A device change touches A2A-agents' HA config and `owned` lists and
  this repo's `config/devices.yaml` together.
- Read config only through `homeconfig.load_config()`. Tokens are never written in `config/`; each
  entry names an environment variable (A2A-agents' `.env`).
- The Gateway is the only Home Assistant client that holds the HA token. It forwards a service call
  only when every target entity is owned by the calling agent and the service is in `SERVICES`
  (`gateway/main.py`); everything else is refused before it reaches HA. Never add a pass-through.
- The Gateway shows dashboards and agents only entities listed in `config/devices.yaml`
  (other HA entities, such as people and zones, may hold personal data).
- The Event Collector stores only the fields of `collector/events.py`; unknown fields are dropped.
  Never add a free-form data field: context values (calendar titles, GPS) must not reach the log.
- After changing `collector/events.py` or `gateway/stream.py`, run `python scripts/export_schemas.py`
  and commit `contracts/`.
- Service modules that declare FastAPI routes with `common.auth` types must not use
  `from __future__ import annotations` (FastAPI reads those annotations at runtime).
