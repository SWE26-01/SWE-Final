# Contracts

What dashboards and agents exchange with this repo's services. Generated from code by
`python scripts/export_schemas.py`; CI fails if they are out of date. Change them by PR with the
consuming team reviewing.

| File | Between | Source of truth |
| --- | --- | --- |
| `gateway/stream.schema.json` | Device Gateway → dashboards (WebSocket `/ws`): `snapshot`, `device.state_changed` | `gateway/stream.py` |
| `collector/event.schema.json` | A2A-agents agents → Event Collector (`POST /events`), Collector → dashboards (`GET /events`, WebSocket `/ws`) | `collector/events.py` |

Agents call the Gateway with Home Assistant's own REST API shape (`GET /api/states/<entity>`,
`POST /api/services/<domain>/<service>`), so that contract is Home Assistant's. Agent-to-agent
messages are A2A-agents' `spec/ambient-a2a.md`. Device and agent ids: `config/devices.yaml`.
