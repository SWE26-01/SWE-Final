# Rules for `services/` (Python: Device Gateway, Event Collector; new Python services such as the Hub go here too)

The repo-wide rules are in `../CLAUDE.md`. These apply when changing `services/`.

- Device IDs (Home Assistant entity ids) follow `../homeassistant`. A device change touches the HA
  config and `config/devices.yaml` together; each device's owner is an agent in `config/agents.yaml`.
- Tests use their own config (`tests/config`: `home` owns the devices, `coach` owns none), so the repo
  config can change freely; `tests/test_homeconfig.py` checks the repo config and the HA helpers.
- Read config only through `homeconfig.load_config()`. Tokens are never written in `config/`; each
  entry names an environment variable (the root `.env`).
- The Gateway is the only Home Assistant client that should hold the HA token. It forwards a service
  call only when every target entity is owned by the calling agent and the service is in `SERVICES`
  (`gateway/main.py`); everything else is refused before it reaches HA. Never add a pass-through.
- The Gateway shows dashboards and agents only entities listed in `config/devices.yaml`
  (other HA entities, such as people and zones, may hold personal data).
- The Event Collector stores only the fields of `collector/events.py`; unknown fields are dropped.
  Never add a free-form data field: personal data and secrets must not reach the log.
- After changing `collector/events.py`, `collector/flows.py`, `collector/agents.py` or
  `gateway/stream.py`, run `python scripts/export_schemas.py` and commit `contracts/`.
- Service modules that declare FastAPI routes with `common.auth` types must not use
  `from __future__ import annotations` (FastAPI reads those annotations at runtime).
