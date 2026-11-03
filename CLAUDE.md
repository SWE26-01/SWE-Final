Read `docs/HANDOFF.md` first for project context and decisions, then `AGENT_HUB_STUDIO_DEV_PLAN.md`.

# Rules for AI coding tools (Claude Code, Copilot, Cursor …)

Monorepo: `services/` (Python: Device Gateway + Event Collector; the Hub, Studio generation service,
spec validator, runtime and Home Agent are added here; its own rules are in `services/CLAUDE.md`),
`homeassistant/` (virtual devices), `scripts/` (setup, run). There is no UI yet; the Studio, Hub and
simulator screens will be React + TypeScript.

- A2A **v1.0 only**. Do not write v0.3 code:
  - methods are `SendMessage`, `GetTask` … (not `message/send`, `tasks/get`)
  - enums are `TASK_STATE_COMPLETED`, `ROLE_USER` … (not `completed`, `user`)
  - a `Part` holds exactly one of `text` / `raw` / `url` / `data`; there is no `kind` field
- The LLM writes specs (Studio) and guidance text (runtime) only. Authentication, permissions,
  timers and session transitions are code.
- Contracts before code: `AgentSpec`, `ConnectionBinding`, the tool catalog and Home-A2A messages are
  agreed as shared JSON examples first. Never invent ad-hoc JSON shapes between components.
- An Agent Card is generated deterministically from a validated spec and its endpoint; it is neither
  code nor a permission grant.
- A shared spec never holds per-home data or secrets. Home id, space mapping, approved permissions and
  credential references live in the `ConnectionBinding`.
- Only the Home Agent commands devices (through the Device Gateway). Other agents ask it over A2A, and
  it checks the connection's approved permissions and its policies on every request.
- Never put tokens or passwords in specs, Agent Cards or logs; trace a flow by its request id instead.
- Device IDs (HA entity ids) and owners must agree across `homeassistant/config/configuration.yaml`
  and `services/config/devices.yaml` (`services/tests/test_homeconfig.py` checks it).
- Secrets live only in the root `.env` (created by `scripts/setup.sh`, git-ignored).
- Everything is edited in this repo. The old upstream repos (SWE26-01/A2A-agents, SWE-frontend,
  a2a-agentic-home) are no longer synced.
- A browser UI reads the services with the read-only dashboard token and never holds an agent token
  or the HA token, so it never commands devices directly.
