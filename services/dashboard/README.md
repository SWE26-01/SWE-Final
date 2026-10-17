# Dashboard (WBS W9)

React + TypeScript. Initialize with:

```bash
npm create vite@latest . -- --template react-ts
```

Screens: A2A log, policy decision results, scenario panel (P0), developer panel (P1).
The floor plan is provided by the 3D simulation (`a2a-agentic-home-3d`); keep a simple 2D fallback until it lands.
Connects to Gateway and Event Collector over WebSocket (`contracts/simulation`).
