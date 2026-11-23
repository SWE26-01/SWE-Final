# Rules for `services/` (Device Gateway, Event Collector, Agent Hub, Studio)

The repo-wide rules are in `../CLAUDE.md`. These apply when changing `services/`.

- Agent IDs (`desktop`, `smartphone`, `root`, `room1`, `room2`, `kitchen`) and device IDs (Home Assistant
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
  `studio/compile.py`. Requests that are not about this home's devices become an
  `assistant_agent`: no device, no permission, and the LLM's one-line `instructions` (at most 10,
  each through `harness.check_text`) go into its AGENTS.md. People talk to connected agents only
  through Hub `POST /agents/{id}/chat` → the launcher (which alone holds the gateway token); chat
  text is never stored or logged by the Hub. Requests with a time of day and a device become a
  `routine_agent`: it owns nothing and gets only `request:<entity>` permissions; at its time it
  asks the Root Agent. Assistant and routine agents are "light": Studio writes `agent.json` and
  AGENTS.md only (`harness.check_light`), and the launcher runs them without an OpenClaw gateway
  (OpenRouter for chats, one A2A call per approved device for routines). In every case the runtime's capability lock (`studio/runtime.py`; for OpenClaw
  `harness.check_rendered`) must pass before an agent is written or registered. Generated agents get
  only the home-a2a plugin tools, and read their own token only from `${AGENT_SELF_TOKEN:-}`. There is no Skill Marketplace: users pick a room, never skills.
  A new runtime (e.g. Python) is one class in `runtime.RUNTIMES`; AgentSpec and the Hub stay as
  they are. New dangerous patterns go in
  `harness._RULES` with a test in `tests/test_studio_harness.py`.
- People are Hub accounts (`agenthub/accounts.py`): scrypt password hashes, and login sessions stored
  as sha256 only, like agent tokens. A session is a `user` caller everywhere: the Hub checks it itself,
  Studio asks the Hub (`GET /auth/me`, cached briefly). An account sees the platform agents, its own,
  the shared ones and whatever is connected; only an agent's maker shares or removes it, and each
  Studio draft belongs to the account that wrote it. Config callers (`HOME_USER_TOKEN`, scripts and
  tests) see and manage everything. Studio's service token (`STUDIO_TOKEN`) only registers agents in
  the Hub (with `created_by`). None of them commands a device.
- The Hub, Studio and the Collector use PostgreSQL in Docker (databases `hub`, `studio`, `collector`;
  made at startup if missing) and SQLite elsewhere (`common/db.py`). `create_all` never changes a
  table: a new column must be nullable or have a server default, and `add_missing_columns` adds it
  to older databases at startup.

