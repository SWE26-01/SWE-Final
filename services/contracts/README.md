# Contracts

Interfaces shared across teams. Change these by PR with both sides reviewing.

| Folder | Between | Source of truth |
| --- | --- | --- |
| `ambient/` | Agent ↔ Agent (Ambient-A2A messages in A2A DataParts) | generated from `ambient/schemas.py` by `scripts/export_schemas.py` |
| `gateway/` | Device Gateway → dashboard (WebSocket), scenario replay → Gateway (inputs) | hand-written; IDs from `config/devices.yaml` |
| `collector/` | Agent → Event Collector (`POST /events`), Event Collector → dashboard (`GET /events`, WebSocket `/ws`) | generated from `collector/events.py` by `scripts/export_schemas.py` |

Space IDs: `my_room`, `baby_room`, `elderly_room`, `living_room`, `entrance`.
