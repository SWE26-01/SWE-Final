# Rules for `services/` (Device Gateway, Event Collector, Runner, Agent Hub, Studio)

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
- Agent Hub (`agenthub/`): every device has one owner among active connections; `POST /connections`
  refuses a device another connected agent holds. Store only the sha256 of a Hub-issued token and
  show the token once. Platform agents (config/agents.yaml) can be disconnected, never removed.
- Studio (`studio/`): the LLM only fills the slot form (`studio/slots.py`, enums from the catalogs).
  It never writes rules, device ids, tools or paths: rules come from `config/skills.yaml` through
  `studio/compile.py`, and `harness.check_rendered` must pass before a profile is written or
  registered. Generated agents get only the Ambient-A2A tools. New dangerous patterns go in
  `harness._RULES` with a test in `tests/test_studio_harness.py`.
- The home user (`HOME_USER_TOKEN`) creates, connects and disconnects agents; Studio's service token
  (`STUDIO_TOKEN`) only registers agents in the Hub. Neither commands a device.

