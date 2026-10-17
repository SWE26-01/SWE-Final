Read `docs/HANDOFF.md` first for project context and decisions.

# Rules for AI coding tools (Claude Code, Copilot, Cursor …)

- A2A **v1.0 only**, via `a2a-sdk` 1.2.x. Do not write v0.3 code:
  - methods are `SendMessage`, `SendStreamingMessage`, `GetTask` … (not `message/send`, `tasks/get`)
  - enums are `TASK_STATE_COMPLETED`, `ROLE_USER` … (not `completed`, `user`)
  - a `Part` holds exactly one of `text` / `raw` / `url` / `data`; there is no `kind` field
- In an `AgentExecutor`, enqueue the Task (`new_task_from_user_message`) before any status update,
  or the SDK raises `InvalidAgentResponseError`.
- Ambient-A2A payloads go in a DataPart and must be one of the models in `ambient/schemas.py`.
  Use `ambient.a2a_codec.to_message` / `from_parts`. Never invent ad-hoc JSON shapes.
- IDs and sequence numbers are strings (A2A data passes through protobuf Struct; ints become floats).
- Read config only through `homeconfig.load_config()` (never parse `config/*.yaml` directly).
- Device IDs, space IDs and owners come from `config/devices.yaml`. Only the owner agent may command a device;
  other agents send `device.control` to the owner.
- Never send raw personal data (calendar titles, GPS coordinates) between agents. Only fields listed in
  `ambient.schemas.CONTEXT_FIELDS`.
- After changing `ambient/schemas.py`, run `python scripts/export_schemas.py` and commit `contracts/`.
