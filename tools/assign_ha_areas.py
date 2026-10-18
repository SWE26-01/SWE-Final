"""Create Home Assistant areas and assign configured devices to them.

Run with HA_URL and HA_TOKEN in the environment after Home Assistant has loaded
the entities from homeassistant/config/configuration.yaml.
"""

import asyncio
import json
import os
from pathlib import Path

import websockets
import yaml

ROOT = Path(__file__).resolve().parents[1]
AREA_NAMES = {
    "kitchen": "주방",
    "dining": "다이닝",
    "living": "거실",
    "veranda": "베란다",
    "bath1": "욕실 1",
    "bedroom1": "침실 1",
    "bedroom2": "침실 2",
    "bath2": "욕실 2",
    "bedroom3": "침실 3",
}


async def main() -> None:
    ha_url = os.environ.get("HA_URL", "http://127.0.0.1:8123").rstrip("/")
    token = os.environ["HA_TOKEN"]
    devices = yaml.safe_load((ROOT / "services/config/devices.yaml").read_text())["devices"]
    websocket_url = ha_url.replace("http://", "ws://", 1).replace("https://", "wss://", 1)

    async with websockets.connect(f"{websocket_url}/api/websocket") as socket:
        await socket.recv()
        await socket.send(json.dumps({"type": "auth", "access_token": token}))
        if json.loads(await socket.recv()).get("type") != "auth_ok":
            raise RuntimeError("Home Assistant rejected HA_TOKEN")

        request_id = 0

        async def call(message_type: str, **data):
            nonlocal request_id
            request_id += 1
            await socket.send(json.dumps({"id": request_id, "type": message_type, **data}))
            response = json.loads(await socket.recv())
            if not response.get("success"):
                raise RuntimeError(f"{message_type} failed: {response.get('error')}")
            return response.get("result")

        areas = await call("config/area_registry/list")
        area_ids = {area["name"]: area["area_id"] for area in areas}
        for area_name in AREA_NAMES.values():
            if area_name not in area_ids:
                created = await call("config/area_registry/create", name=area_name)
                area_ids[area_name] = created["area_id"]

        registry = {item["entity_id"] for item in await call("config/entity_registry/list")}
        assigned = 0
        for device in devices:
            entity = device["entity"]
            if entity not in registry:
                continue
            await call(
                "config/entity_registry/update",
                entity_id=entity,
                area_id=area_ids[AREA_NAMES[device["space"]]],
            )
            assigned += 1

    print(f"areas={len(AREA_NAMES)} assigned_entities={assigned}")


if __name__ == "__main__":
    asyncio.run(main())
