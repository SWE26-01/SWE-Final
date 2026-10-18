Read `docs/HANDOFF.md` first for project context and decisions.

# Rules for AI coding tools (Claude Code, Copilot, Cursor …)

Monorepo: `agents/` (OpenClaw agents + the `ambient-a2a` plugin, TypeScript), `spec/` (Ambient-A2A
extension spec), `homeassistant/` (virtual devices), `scripts/` (setup, run, checks), `services/`
(Device Gateway + Event Collector, Python; its own rules are in `services/CLAUDE.md`),
`frontend/` (simulator UI, React; owned by the frontend team).

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
- Agent IDs, device IDs (HA entity ids) and ownership must agree across
  `homeassistant/config/configuration.yaml`, each agent's `owned` list in `agents/**/openclaw.json5`
  and `services/config/devices.yaml`.
- Secrets live only in the root `.env` (created by `scripts/setup.sh`, git-ignored).
- Keep repo paths ASCII: OpenClaw rejects non-ASCII (NFD) paths (see `scripts/oc.sh`).
- Upstream-owned paths are synced in from the original repos with `tools/sync_upstream.sh` and are
  not edited here: `agents/`, `spec/`, `homeassistant/`, `scripts/`, `plan.md` (SWE26-01/A2A-agents)
  and `frontend/` (SWE26-01/SWE-frontend). Propose such changes as a PR to the original repo.
  Edit freely: `services/`, `docs/`, `tools/`, `.github/`, root `CLAUDE.md`/`AGENTS.md`.
