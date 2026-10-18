# Contracts

What dashboards and agents exchange with this repo's services. Generated from code by
`python scripts/export_schemas.py`; CI fails if they are out of date. Change them by PR with the
consuming team reviewing.

| File | Between | Source of truth |
| --- | --- | --- |
| `gateway/stream.schema.json` | Device Gateway → dashboards (WebSocket `/ws`): `snapshot`, `device.state_changed` | `gateway/stream.py` |
| `collector/flow.schema.json` | Event Collector → dashboards (`GET /flows`, `GET /flows/{flow}`): one request followed across agents | `collector/flows.py` |
| `collector/event.schema.json` | agents → Event Collector (`POST /events`), Collector → dashboards (`GET /events`, WebSocket `/ws`) | `collector/events.py` |

Agents call the Gateway with Home Assistant's own REST API shape (`GET /api/states/<entity>`,
`POST /api/services/<domain>/<service>`), so that contract is Home Assistant's. Stored events come
back with `id` and, when they carry a `request_id`, `flow` (its part before the first `/`).
`id` is arrival order; `ts` is when the event happened. Agents post concurrently, so the two can
differ: `GET /events` and the WebSocket follow `id`, while `/flows` orders each request by `ts`. Agent-to-agent
messages are `../spec/ambient-a2a.md`. Device and agent ids: `config/devices.yaml`.
