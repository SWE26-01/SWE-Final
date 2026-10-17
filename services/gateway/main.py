"""Virtual Device Gateway (WBS W8). Source of truth for device state.

Run: uvicorn gateway.main:app --port 8100
"""

from pathlib import Path

import yaml
from fastapi import FastAPI

CONFIG = Path(__file__).resolve().parent.parent / "config"

app = FastAPI(title="Virtual Device Gateway")
devices: dict[str, dict] = {
    d["id"]: d for d in yaml.safe_load((CONFIG / "devices.yaml").read_text())["devices"]
}


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/devices")
def list_devices() -> list[dict]:
    return list(devices.values())


# TODO(W8-1): POST /devices/{id}/commands — owner check (403), request_id dedupe
# TODO(W8-4): WebSocket broadcast of device.state_changed
# TODO(W8-3): POST /scenarios/{id}/run
