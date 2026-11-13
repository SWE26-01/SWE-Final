Read `docs/HANDOFF.md` first for project context and decisions, then `docs/PROPOSAL.md`.

# Rules for AI coding tools (Claude Code, Copilot, Cursor …)

Monorepo: `services/` (Python: Device Gateway + Event Collector; new Python services such as the Hub
go here too; its own rules are in `services/CLAUDE.md`), `homeassistant/` (virtual devices),
`scripts/` (setup, run). There is no UI yet; the Studio and Hub screens will be React +
TypeScript.

- Agents run on the Python runtime (a2a-sdk): A2A server, Agent Card, Skills, permission checks,
  device calls and timers are Python. OpenClaw is used only for an agent's chat replies to the
  user; never move permission checks or device access into OpenClaw.
- A2A **v1.0 only**. Do not write v0.3 code:
  - methods are `SendMessage`, `GetTask` … (not `message/send`, `tasks/get`)
  - enums are `TASK_STATE_COMPLETED`, `ROLE_USER` … (not `completed`, `user`)
  - a `Part` holds exactly one of `text` / `raw` / `url` / `data`; there is no `kind` field
- Authentication, permissions and connection approval are code, never left to an LLM prompt.
- Skills are provided by the platform in code; there is no Skill Marketplace.
- Contracts before code: the agent definition (Studio output), Skills, Hub records and messages
  between agents are agreed as shared JSON examples first. Never invent ad-hoc JSON shapes between
  components.
- An Agent Card is generated deterministically from a validated agent definition and its endpoint;
  it is neither code nor a permission grant.
- A shared agent definition or Skill never holds per-deployment data or secrets. Approved
  permissions, endpoints and credential references live in the Hub's connection record.
- An agent commands only the devices it owns, through the Device Gateway
  (`services/config/devices.yaml`); for other devices it asks their owner over A2A. Nothing else
  holds the HA token.
- Never put tokens or passwords in agent definitions, Skills, Agent Cards or logs; trace a flow by
  its request id instead.
- Device IDs (HA entity ids) and owners must agree across `homeassistant/config/configuration.yaml`
  and `services/config/devices.yaml` (`services/tests/test_homeconfig.py` checks it).
- Secrets live only in the root `.env` (created by `scripts/setup.sh`, git-ignored).
- Everything is edited in this repo. The old upstream repos (SWE26-01/A2A-agents, SWE-frontend,
  a2a-agentic-home) are no longer synced.
- A browser UI reads the services with the read-only dashboard token and never holds an agent token
  or the HA token, so it never commands devices directly.
