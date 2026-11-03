"""Device Gateway: checks who may move which device, in front of Home Assistant.

The Home Agent calls it exactly like the Home Assistant REST API, with its own agent token instead
of the HA token. For every command the Gateway checks that the caller owns each target entity
(config/devices.yaml), and only then forwards it with the one real HA token. Dashboards read device
states over WebSocket /ws.

Run: uvicorn gateway.main:build --factory --port 8100 --env-file ../.env
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import FastAPI, Request, WebSocket, status
from fastapi.responses import JSONResponse
from starlette.websockets import WebSocketDisconnect

from common.auth import make_auth, ws_caller
from common.cors import allow_dashboards
from common.hub import Hub, push
from common.logs import hide_tokens_in_server_logs
from gateway.ha import HomeAssistant, State, StateStream
from gateway.stream import DeviceState, Snapshot, StateChanged
from homeconfig import ConfigError, HomeConfig, load_config
from homeconfig.models import Role

log = logging.getLogger(__name__)

# Services an agent may call, per entity domain, with the data keys each one takes.
SERVICES: dict[str, dict[str, frozenset[str]]] = {
    "input_boolean": {"turn_on": frozenset(), "turn_off": frozenset(), "toggle": frozenset()},
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
        raise Blocked(403, f"{domain}.{service} is not a device command the Gateway forwards")
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
            raise Blocked(403, f"{entity} is owned by {owner}")
        if not entity.startswith(f"{domain}."):
            raise Blocked(400, f"{entity} is not an {domain} entity")
    return entities


def _message(status_code: int, text: str) -> JSONResponse:
    # Home Assistant answers errors as {"message": ...}; keep that shape.
    return JSONResponse({"message": text}, status_code=status_code)


async def _forward(call: Awaitable[httpx.Response]) -> JSONResponse:
    try:
        resp = await call
    except httpx.HTTPError as e:
        log.warning("Home Assistant request failed: %r", e)
        return _message(status.HTTP_502_BAD_GATEWAY, "Home Assistant is unreachable")
    try:
        content = resp.json()
    except ValueError:
        content = {"message": resp.text}
    return JSONResponse(content, status_code=resp.status_code)


class Devices:
    """Latest Home Assistant state of every configured device, fanned out to dashboards."""

    def __init__(self, config: HomeConfig) -> None:
        self._config = config
        self._states: dict[str, State] = {}
        self.ha_connected = False
        self.hub = Hub()

    def view(self, entity: str) -> DeviceState:
        device = self._config.devices[entity]
        state = self._states.get(entity, {})
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
        return Snapshot(ha_connected=self.ha_connected, devices=devices).model_dump(mode="json")

    def reload(self, states: list[State]) -> None:
        home = self._config.devices
        self._states = {s["entity_id"]: s for s in states if s.get("entity_id") in home}
        self.ha_connected = True
        self.hub.publish(self.snapshot())

    def disconnected(self) -> None:
        self.ha_connected = False
        self.hub.publish(self.snapshot())

    def change(self, data: dict[str, Any], time_fired: str) -> None:
        entity, new, old = data["entity_id"], data.get("new_state"), data.get("old_state")
        if new is None:
            self._states.pop(entity, None)
        else:
            self._states[entity] = new
        changed = StateChanged(
            at=time_fired or datetime.now(UTC),
            device=self.view(entity),
            previous=old.get("state") if old else None,
        )
        self.hub.publish(changed.model_dump(mode="json"))


def create_app(
    config: HomeConfig,
    *,
    ha_transport: httpx.AsyncBaseTransport | None = None,
    ws_connect: Any = None,
    stream: bool = True,
) -> FastAPI:
    """Build the Gateway. `stream=False` skips the Home Assistant event stream (tests)."""
    if config.ha_token is None:
        raise ConfigError(["HA_TOKEN is not set: the Gateway needs a Home Assistant token"])
    ha = HomeAssistant(config.ha_url, config.ha_token, transport=ha_transport)
    devices = Devices(config)
    auth = make_auth(config)

    async def load_all() -> None:
        devices.reload(await ha.states())

    async def on_change(data: dict[str, Any], time_fired: str) -> None:
        devices.change(data, time_fired)

    async def on_disconnect() -> None:
        devices.disconnected()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        task = None
        if stream:
            follow = StateStream(
                config.ha_url,
                config.ha_token,
                set(config.devices),
                on_connect=load_all,
                on_change=on_change,
                on_disconnect=on_disconnect,
                **({} if ws_connect is None else {"connect": ws_connect}),
            )
            task = asyncio.create_task(follow.run())
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            await ha.aclose()

    app = FastAPI(title="Device Gateway", lifespan=lifespan)
    hide_tokens_in_server_logs()
    app.state.devices = devices
    allow_dashboards(app, config)

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "ha_connected": devices.ha_connected}

    @app.get("/devices")
    async def list_devices(_: auth.caller) -> list[dict]:
        return [devices.view(e).model_dump(mode="json") for e in config.devices]

    @app.get("/api/states/{entity_id}")
    async def get_state(entity_id: str, _: auth.caller) -> JSONResponse:
        if entity_id not in config.devices:  # other HA entities (people, zones) stay hidden
            return _message(status.HTTP_404_NOT_FOUND, "Entity not found.")
        return await _forward(ha.get_state(entity_id))

    @app.post("/api/services/{domain}/{service}")
    async def call_service(domain: str, service: str, request: Request, who: auth.agent):
        try:
            body = await request.json()
        except ValueError:
            body = None
        try:
            entities = targets(config, who.id, domain, service, body)
        except Blocked as e:
            log.warning("blocked %s -> %s.%s: %s", who.id, domain, service, e.message)
            return _message(e.status_code, e.message)
        forwarded = {**body, "entity_id": entities}
        return await _forward(ha.call_service(domain, service, forwarded))

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
