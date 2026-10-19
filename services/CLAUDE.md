# Rules for `services/` (Device Gateway, Event Collector, Runner)

The repo-wide rules are in `../CLAUDE.md`. These apply when changing `services/`.

- Agent IDs (`desktop`, `smartphone`, `orchestrator`, `room1`, `room2`) and device IDs (Home Assistant
  entity ids) follow `../agents` and `../homeassistant`. A device change touches the HA config, the
  agents' `owned` lists and `config/devices.yaml` together.
- Read config only through `homeconfig.load_config()`. Tokens are never written in `config/`; each
  entry names an environment variable (the root `.env`).
- The Gateway is the only Home Assistant client that should hold the HA token. It forwards a service
  call only when every target entity is owned by the calling agent and the service is in `SERVICES`
  (`gateway/main.py`); everything else is refused before it reaches HA. Never add a pass-through.
- The Gateway shows dashboards and agents only entities listed in `config/devices.yaml`
  (other HA entities, such as people and zones, may hold personal data).
- The Event Collector stores only the fields of `collector/events.py`; unknown fields are dropped.
  Never add a free-form data field: context values (calendar titles, GPS) must not reach the log.
- The Runner (Live Simulation) only says text to an agent's LLM through its OpenClaw chat endpoint
  (`runner/openclaw.py`), like a user in a chat. It never calls the Gateway or Home Assistant and holds
  no agent token, so it cannot move a device or speak as an agent. Only the simulator token
  (`SIMULATOR_TOKEN`) starts runs; the dashboard token stays read-only. Only the Runner uses
  `OPENCLAW_GATEWAY_TOKEN`. Runs live in memory; what was said and answered stays out of the server log.
- Scenarios live in `config/scenarios.yaml` (checked by `homeconfig`). A setup step asks the device's
  own agent; never add a Gateway or HA shortcut to prepare a scenario.
- After changing `collector/events.py`, `collector/flows.py`, `gateway/stream.py`, `runner/stream.py` or
  the scenario models in `homeconfig/models.py`, run `python scripts/export_schemas.py` and commit `contracts/`.
- Service modules that declare FastAPI routes with `common.auth` types must not use
  `from __future__ import annotations` (FastAPI reads those annotations at runtime).
