# Contracts

Interfaces shared across teams. Change these by PR with both sides reviewing.

| Folder | Between | Source of truth |
| --- | --- | --- |
| `ambient/` | Agent ↔ Agent (Ambient-A2A messages in A2A DataParts) | generated from `ambient/schemas.py` by `scripts/export_schemas.py` |
| `simulation/` | Device Gateway ↔ 3D simulation (`a2a-agentic-home-3d`) | hand-written; IDs from `config/devices.yaml` |

Space IDs: `my_room`, `baby_room`, `elderly_room`, `living_room`, `entrance`.
