Read `docs/HANDOFF.md` first for project context and decisions.

# Rules for AI coding tools (Claude Code, Copilot, Cursor …)

Monorepo: `agents/` (OpenClaw agents + the `ambient-a2a` plugin, TypeScript), `spec/` (Ambient-A2A
extension spec), `services/` (Device Gateway with the virtual home + Event Collector + Agent Hub +
Studio, Python; its own rules are in `services/CLAUDE.md`), `agent_hub_FE/` (Agent Hub screen,
Next.js), `scripts/` (setup, run, checks), `training/` (SLM experiments), `docker-compose.yml`
(runs everything). Plan: `plan.md` (from `docs/presentation/presentation.pdf`).

- A2A **v1.0 only**. Do not write v0.3 code:
  - methods are `SendMessage`, `GetTask` … (not `message/send`, `tasks/get`)
  - enums are `TASK_STATE_COMPLETED`, `ROLE_USER` … (not `completed`, `user`)
  - a `Part` holds exactly one of `text` / `raw` / `url` / `data`; there is no `kind` field
- Ambient-A2A payloads are one DataPart whose `data.type` is a message in `spec/ambient-a2a.md`.
  Change the spec first, then the plugin, never ad-hoc JSON shapes.
- Each device has exactly one owning agent. Other agents ask the owner with `device.control`;
  Home delegates room devices with `on_behalf_of`. Safety policies apply to every requester.
- Never send raw personal data (calendar titles, GPS coordinates) between agents or into logs.
  Agents publish only their `provides` fields, filtered by the requester's ACL.
- There is no Home Assistant. The Device Gateway keeps the virtual devices (`services/gateway/home.py`)
  and answers in Home Assistant's REST shape; agents reach devices only through it, with their own
  token (`gatewayUrl`).
- Agent IDs, device IDs (HA entity id format) and ownership must agree across
  `services/config/devices.yaml`, each agent's `owned` list in `agents/**/openclaw.json5` and the
  device tables in `agents/**/AGENTS.md`.
- Secrets live only in the root `.env` (created by `scripts/setup.sh`, git-ignored).
- Keep repo paths ASCII: OpenClaw rejects non-ASCII (NFD) paths (see `scripts/oc.sh`).
- `docker compose up -d --build` must keep starting everything. A new service goes into the root
  `docker-compose.yml`, with ports published on 127.0.0.1 only.
- Since 2026-10-18 SWE26-01/A2A-agents and SWE26-01/SWE-frontend are no longer developed; everything
  is edited here.
- People log in with Hub accounts (`POST /auth/signup|login`). The browser holds only its own session,
  in an httpOnly cookie set by `agent_hub_FE` (`app/api/auth/[action]`); never a service, OpenClaw or
  agent token. `agent_hub_FE` calls the services only through its server-side proxy
  (`app/api/[service]/[...path]`, allowlist in `lib/proxy.js`): the session goes to the Hub and Studio,
  the read-only dashboard token to the Collector and Gateway after the session is checked. Add a route
  there only for a call the screen needs, and never device commands, `tokens/verify` or agent registration.
