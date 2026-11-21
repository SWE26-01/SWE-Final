# Rules for `services/` (Device Gateway, Event Collector, Agent Hub, Studio)

The repo-wide rules are in `../CLAUDE.md`. These apply when changing `services/`.

- Agent IDs (`desktop`, `smartphone`, `orchestrator`, `room1`, `room2`) and device IDs (Home Assistant
  entity id format) follow `../agents`. A device change touches the agents' `owned` lists, their
  `AGENTS.md` tables and `config/devices.yaml` together.
- Read config only through `homeconfig.load_config()`. Tokens are never written in `config/`; each
  entry names an environment variable (the root `.env`).
- The Gateway keeps the virtual home itself (`gateway/home.py`): every device of `config/devices.yaml`,
  in memory, starting in its initial state. There is no Home Assistant. It changes a device only when
  every target entity is owned by the calling agent and the service is in `SERVICES`
  (`gateway/main.py`); everything else is refused before anything changes. Never add a bypass.
- With `GATEWAY_HUB_URL` the Agent Hub is in charge (`common/hublink.py`): Hub-issued tokens are
  verified there and the owner of a device is the agent connected as its owner now (Hub
  `GET /ownership`). If the Hub cannot be reached, commands are refused; never fall back to
  `devices.yaml` owners. The Collector (`COLLECTOR_HUB_URL`) accepts and watches the same agents.
  Both ask the Hub with the `runtime` service token, which must never register agents.
- The Event Collector stores only the fields of `collector/events.py`; unknown fields are dropped.
  Never add a free-form data field: context values (calendar titles, GPS) must not reach the log.
- After changing `collector/events.py`, `collector/flows.py` or `gateway/stream.py`, run
  `python scripts/export_schemas.py` and commit `contracts/`.
- Every service runs from the root `docker-compose.yml` (image built from `Dockerfile` here).
- Service modules that declare FastAPI routes with `common.auth` types must not use
  `from __future__ import annotations` (FastAPI reads those annotations at runtime).
- Agent Hub (`agenthub/`): every device has one owner among active connections; `POST /connections`
  refuses a device another connected agent holds. Store only the sha256 of a Hub-issued token and
  show the token once. Platform agents (config/agents.yaml) can be disconnected, never removed.
  Connecting a Studio agent hands its token once to the launcher (`HUB_LAUNCHER_URL`,
  `../scripts/launcher.mjs`), which starts it; disconnecting or removing stops it. A launcher
  failure never undoes the connection; it is reported in `launch`.
- Studio (`studio/`): the LLM only fills the slot form (`studio/slots.py`, enums from the catalogs).
  It never writes rules, device ids, tools or paths: rules come from `config/skills.yaml` through
  `studio/compile.py`, and the runtime's capability lock (`studio/runtime.py`; for OpenClaw
  `harness.check_rendered`) must pass before an agent is written or registered. Generated agents get
  only the ambient-a2a plugin tools, and read their own token only from `${AMBIENT_AGENT_TOKEN:-}`. There is no Skill Marketplace: users pick a room, never skills.
  A new runtime (e.g. Python) is one class in `runtime.RUNTIMES`; AgentSpec and the Hub stay as
  they are. New dangerous patterns go in
  `harness._RULES` with a test in `tests/test_studio_harness.py`.
- The home user (`HOME_USER_TOKEN`) creates, connects and disconnects agents; Studio's service token
  (`STUDIO_TOKEN`) only registers agents in the Hub. Neither commands a device.

