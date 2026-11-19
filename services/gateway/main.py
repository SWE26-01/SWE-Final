"""Device Gateway: the virtual home, and who may move which device (plan 3.1).

It keeps every device of config/devices.yaml itself (gateway/home.py); there is no Home Assistant.
The agents (../agents) call it like the Home Assistant REST API with their own agent token: their
`gatewayUrl` points here. For every command the Gateway checks that the caller owns each target
entity, and only then changes the device. Dashboards read device states over WebSocket /ws.

Run: uvicorn gateway.main:build --factory --port 8100 --env-file ../.env
"""

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Request, WebSocket, status
from fastapi.responses import JSONResponse
from starlette.websockets import WebSocketDisconnect

from common.auth import make_auth, ws_caller
from common.cors import allow_dashboards
from common.hub import Hub, push
from common.logs import hide_tokens_in_server_logs
from gateway.home import BadValue, VirtualHome
from gateway.stream import DeviceState, Snapshot, StateChanged
from homeconfig import HomeConfig, load_config
from homeconfig.models import Role

log = logging.getLogger(__name__)

# Services an agent may call, per entity domain, with the data keys each one takes.
SERVICES: dict[str, dict[str, frozenset[str]]] = {
    "input_boolean": {"turn_on": frozenset(), "turn_off": frozenset(), "toggle": frozenset()},
    "input_select": {"select_option": frozenset({"option"})},
    "input_number": {"set_value": frozenset({"value"})},
}


class Blocked(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def targets(config: HomeConfig, agent_id: str, domain: str, service: str, body: Any) -> list[str]:
    """Entities a service call would touch, after checking that `agent_id` owns every one.
    Raises Blocked for anything that is not a plain command on the caller's own devices."""
    data_keys = SERVICES.get(domain, {}).get(service)
    if data_keys is None:
        raise Blocked(403, f"{domain}.{service} is not a device command the Gateway runs")
    if not isinstance(body, dict):
        raise Blocked(400, "body must be a JSON object")
    keys = set(body) - {"entity_id"}
    if keys != data_keys:
        raise Blocked(400, f"{domain}.{service} takes entity_id and {sorted(data_keys)}")
    raw = body.get("entity_id")
    if isinstance(raw, str):
        entities = raw.split(",")  # Home Assistant also accepts "a, b"
    elif isinstance(raw, list) and all(isinstance(e, str) for e in raw):
        entities = raw
    else:
        raise Blocked(400, "entity_id must be an entity id or a list of them")
    entities = [e.strip() for e in entities]
    if not entities or not all(entities):
        raise Blocked(400, "entity_id is empty")
    for entity in entities:
        owner = config.owner_of(entity)
        if owner is None:
            raise Blocked(403, f"{entity} is not a home device")
        if owner != agent_id:
            raise Blocked(403, f"{entity} is owned by {owner}; send device.control to {owner}")
        if not entity.startswith(f"{domain}."):
            raise Blocked(400, f"{entity} is not an {domain} entity")
    return entities


def _message(status_code: int, text: str) -> JSONResponse:
    # Home Assistant answers errors as {"message": ...}; keep that shape for the agents.
    return JSONResponse({"message": text}, status_code=status_code)


class Devices:
    """The virtual home's devices as dashboards see them, with every change fanned out."""

    def __init__(self, config: HomeConfig) -> None:
        self._config = config
        self.home = VirtualHome(config)
        self.hub = Hub()

    def view(self, entity: str) -> DeviceState:
        device = self._config.devices[entity]
        state = self.home.get(entity) or {}
        return DeviceState(
            entity=entity,
            space=device.space,
            owner=device.owner,
            state=state.get("state"),
            attributes=state.get("attributes", {}),
            last_changed=state.get("last_changed"),
        )

    def snapshot(self) -> dict[str, Any]:
        devices = [self.view(e) for e in self._config.devices]
        return Snapshot(devices=devices).model_dump(mode="json")

    def call(self, service: str, entities: list[str], data: dict[str, Any]) -> list[dict]:
        """Apply a checked command to each entity; returns the new states, as HA does."""
        for entity in entities:  # check every value before changing anything
            if service == "select_option":
                options = (self.home.get(entity) or {}).get("attributes", {}).get("options", [])
                if str(data["option"]) not in options:
                    raise BadValue(f"{data['option']!r} is not an option of {entity}")
        states = []
        for entity in entities:
            change = self.home.call(service, entity, data)
            states.append(change.state)
            if change.state["state"] != change.previous:
                changed = StateChanged(
                    at=datetime.now(UTC), device=self.view(entity), previous=change.previous
                )
                self.hub.publish(changed.model_dump(mode="json"))
        return states


def create_app(config: HomeConfig) -> FastAPI:
    devices = Devices(config)
    auth = make_auth(config)
    app = FastAPI(title="Device Gateway")
    hide_tokens_in_server_logs()
    app.state.devices = devices
    allow_dashboards(app, config)

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "devices": len(config.devices)}

    @app.get("/devices")
    async def list_devices(_: auth.caller) -> list[dict]:
        return [devices.view(e).model_dump(mode="json") for e in config.devices]

    @app.get("/api/states/{entity_id}")
    async def get_state(entity_id: str, _: auth.caller) -> JSONResponse:
        state = devices.home.get(entity_id)
        if state is None:
            return _message(status.HTTP_404_NOT_FOUND, "Entity not found.")
        return JSONResponse(state)

    @app.post("/api/services/{domain}/{service}")
    async def call_service(domain: str, service: str, request: Request, who: auth.agent):
        try:
            body = await request.json()
        except ValueError:
            body = None
        try:
            entities = targets(config, who.id, domain, service, body)
            states = devices.call(service, entities, body)
        except Blocked as e:
            log.warning("blocked %s -> %s.%s: %s", who.id, domain, service, e.message)
            return _message(e.status_code, e.message)
        except BadValue as e:
            return _message(status.HTTP_400_BAD_REQUEST, str(e))
        return JSONResponse(states)

    @app.websocket("/ws")
    async def follow_devices(websocket: WebSocket, token: str | None = None) -> None:
        if ws_caller(config, token, Role.OPERATOR) is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        await websocket.accept()
        queue = devices.hub.subscribe()
        try:
            # No await between subscribing and building the snapshot, so nothing is missed.
            await websocket.send_json(devices.snapshot())
            await push(websocket, queue)
        except WebSocketDisconnect:
            pass
        finally:
            devices.hub.unsubscribe(queue)

    return app


def build() -> FastAPI:
    """App for `uvicorn gateway.main:build --factory` (config files + environment)."""
    return create_app(load_config())
