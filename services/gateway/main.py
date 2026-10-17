"""Virtual Device Gateway (WBS W8). Source of truth for device state.

Run: uvicorn gateway.main:app --port 8100
"""

from fastapi import FastAPI

from homeconfig import load_config

config = load_config()
app = FastAPI(title="Virtual Device Gateway")
devices: dict[str, dict] = {d.id: d.model_dump() for d in config.devices.values()}


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/devices")
def list_devices() -> list[dict]:
    return list(devices.values())


# TODO(W8-1): POST /devices/{id}/commands — owner check (403), request_id dedupe
# TODO(W8-4): WebSocket broadcast of device.state_changed
# TODO(W8-3): POST /scenarios/{id}/run
