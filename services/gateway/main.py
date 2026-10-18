"""Device Gateway: checks who may move which device, in front of Home Assistant (plan 5.4).

The agents (../agents) call it exactly like the Home Assistant REST API: their `ha.url` points here
and they send their own agent token instead of the shared HA token. For every command the Gateway
checks that the caller owns each target entity (config/devices.yaml), and only then forwards it
with the one real HA token. Dashboards read device states over WebSocket /ws.

Run: uvicorn gateway.main:build --factory --port 8100 --env-file ../.env
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, Request, WebSocket, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.websockets import WebSocketDisconnect

from common.auth import make_auth, ws_caller
from common.hub import Hub, push
from gateway.ha import HomeAssistant, State, StateStream
from gateway.stream import DeviceState, Snapshot, StateChanged
from homeconfig import ConfigError, HomeConfig, load_config
from homeconfig.models import Role

log = logging.getLogger(__name__)

# Services an agent may call, per entity domain, with the data keys each one takes.
SERVICES: dict[str, dict[str, frozenset[str]]] = {
    "input_boolean": {"turn_on": frozenset(), "turn_off": frozenset(), "toggle": frozenset()},
    "input_select": {"select_option": frozenset({"option"})},
    "input_number": {"set_value": frozenset({"value"})},
}

AREA_TO_SPACE = {
    "주방": "kitchen",
    "다이닝": "dining",
    "거실": "living",
    "베란다": "veranda",
    "배란다": "veranda",
    "욕실 1": "bath1",
    "침실 1": "bedroom1",
    "침실 2": "bedroom2",
    "욕실 2": "bath2",
    "침실 3": "bedroom3",
}
SPACE_OWNER = {"bedroom1": "room1", "bedroom2": "room2", "bedroom3": "room1"}
DEVICE_DOMAINS = {
    "binary_sensor", "button", "climate", "cover", "fan", "humidifier", "input_boolean",
    "input_number", "input_select", "light", "lock", "media_player", "sensor", "switch", "vacuum",
}
DASHBOARD_POWER_SERVICES = {
    "input_boolean": ("turn_on", "turn_off"),
    "light": ("turn_on", "turn_off"),
    "switch": ("turn_on", "turn_off"),
    "fan": ("turn_on", "turn_off"),
    "humidifier": ("turn_on", "turn_off"),
    "media_player": ("turn_on", "turn_off"),
    "climate": ("turn_on", "turn_off"),
    "cover": ("open_cover", "close_cover"),
    "lock": ("lock", "unlock"),
    "vacuum": ("start", "return_to_base"),
}
AGENT_NAMES = {
    "orchestrator": "Home Agent",
    "room1": "My Room Agent",
    "room2": "Room 2 Agent",
    "desktop": "Desktop Agent",
    "smartphone": "Mobile Agent",
}
SEOUL = ZoneInfo("Asia/Seoul")


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
            raise Blocked(403, f"{entity} is owned by {owner}; send device.control to {owner}")
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
    return _ha_response(resp)


def _ha_response(response: httpx.Response) -> JSONResponse:
    try:
        content = response.json()
    except ValueError:
        content = {"message": response.text}
    return JSONResponse(content, status_code=response.status_code)


class AgentActions:
    """Short-lived service calls used to label matching Home Assistant Logbook rows."""

    def __init__(self) -> None:
        self._items: list[dict[str, Any]] = []

    def add(self, agent_id: str, entities: list[str], domain: str, service: str) -> None:
        now = datetime.now(UTC)
        self._items = [item for item in self._items if now - item["at"] < timedelta(hours=24)]
        self._items.extend(
            {
                "at": now,
                "agent_id": agent_id,
                "entity_id": entity,
                "domain": domain,
                "service": service,
            }
            for entity in entities
        )

    def agent_for(self, row: dict[str, Any]) -> str | None:
        try:
            when = datetime.fromisoformat(row["when"])
        except (KeyError, TypeError, ValueError):
            return None
        matches = (
            item for item in reversed(self._items)
            if item["entity_id"] == row.get("entity_id")
            and item["domain"] == row.get("context_domain")
            and item["service"] == row.get("context_service")
            and abs((when - item["at"]).total_seconds()) <= 15
        )
        match = next(matches, None)
        return match["agent_id"] if match else None


def describe_logbook(row: dict[str, Any], agent_id: str | None) -> str:
    name = row.get("name") or row.get("entity_id") or "기기"
    state = row.get("state")
    state_text = {"on": "켜짐", "off": "꺼짐"}.get(state, state or "상태 변경")
    if agent_id:
        agent_name = AGENT_NAMES.get(agent_id, agent_id)
        return f"{agent_name}가 {name} 상태를 {state_text}으로 변경했습니다."
    return f"사용자가 {name} 상태를 {state_text}으로 변경했습니다."


class Devices:
    """Latest Home Assistant state of every configured device, fanned out to dashboards."""

    def __init__(self, config: HomeConfig) -> None:
        self._config = config
        self._states: dict[str, State] = {}
        self._dynamic: dict[str, tuple[str, str]] = {}
        self.ha_connected = False
        self.hub = Hub()

    def view(self, entity: str) -> DeviceState:
        configured = self._config.devices.get(entity)
        space, owner = self._dynamic.get(
            entity,
            (configured.space, configured.owner) if configured else ("", "orchestrator"),
        )
        state = self._states.get(entity, {})
        return DeviceState(
            entity=entity,
            space=space,
            owner=owner,
            state=state.get("state"),
            attributes=state.get("attributes", {}),
            last_changed=state.get("last_changed"),
        )

    def snapshot(self) -> dict[str, Any]:
        entities = self._states if self.ha_connected else self._config.devices
        devices = [self.view(e) for e in entities]
        return Snapshot(ha_connected=self.ha_connected, devices=devices).model_dump(mode="json")

    def visible_entities(self) -> set[str]:
        return set(self._states) | set(self._config.devices)

    def power_service(self, entity: str, turn_on: bool) -> tuple[str, str] | None:
        if entity not in self._states:
            return None
        domain = entity.partition(".")[0]
        services = DASHBOARD_POWER_SERVICES.get(domain)
        return (domain, services[0 if turn_on else 1]) if services else None

    def reload(self, states: list[State], entity_areas: dict[str, str] | None = None) -> None:
        placements = entity_areas or {}
        dynamic = {}
        for entity, area_name in placements.items():
            space = AREA_TO_SPACE.get(area_name)
            domain = entity.partition(".")[0]
            if space and domain in DEVICE_DOMAINS:
                dynamic[entity] = (space, SPACE_OWNER.get(space, "orchestrator"))
        self._dynamic = dynamic
        visible = set(self._config.devices) | set(dynamic)
        self._states = {s["entity_id"]: s for s in states if s.get("entity_id") in visible}
        self.ha_connected = True
        self.hub.publish(self.snapshot())

    def disconnected(self) -> None:
        self.ha_connected = False
        self.hub.publish(self.snapshot())

    def change(self, data: dict[str, Any], time_fired: str) -> None:
        entity, new, old = data["entity_id"], data.get("new_state"), data.get("old_state")
        if entity not in self._config.devices and entity not in self._dynamic:
            return
        if new is None:
            self._states.pop(entity, None)
            self.hub.publish(self.snapshot())
            return
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
    agent_actions = AgentActions()
    auth = make_auth(config)

    async def load_all() -> None:
        states, entity_areas = await asyncio.gather(ha.states(), ha.entity_areas())
        devices.reload(states, entity_areas)

    async def on_change(data: dict[str, Any], time_fired: str) -> None:
        devices.change(data, time_fired)

    async def on_disconnect() -> None:
        devices.disconnected()

    async def on_registry_change() -> None:
        await load_all()

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
                on_registry_change=on_registry_change,
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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.state.devices = devices

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

    @app.post("/dashboard/devices/{entity_id}/{action}")
    async def dashboard_device(
        entity_id: str,
        action: str,
        _: auth.operator,
    ) -> JSONResponse:
        if action not in {"turn_on", "turn_off"}:
            return _message(status.HTTP_400_BAD_REQUEST, "action must be turn_on or turn_off")
        service = devices.power_service(entity_id, action == "turn_on")
        if service is None:
            return _message(status.HTTP_403_FORBIDDEN, "entity is not a controllable device")
        domain, service_name = service
        return await _forward(ha.call_service(domain, service_name, {"entity_id": entity_id}))

    @app.get("/dashboard/activity")
    async def dashboard_activity(
        _: auth.operator,
        limit: int = 50,
        day: date | None = None,
    ) -> JSONResponse:
        limit = max(1, min(limit, 200))
        selected_day = day or datetime.now(SEOUL).date()
        start = datetime.combine(selected_day, time.min, tzinfo=SEOUL).astimezone(UTC)
        end = (start + timedelta(days=1)).astimezone(UTC)
        try:
            response = await ha.logbook(start, end)
            response.raise_for_status()
            rows = response.json()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("Home Assistant logbook request failed: %r", e)
            return _message(status.HTTP_502_BAD_GATEWAY, "Home Assistant logbook is unreachable")
        visible = devices.visible_entities()
        activity = []
        for row in rows:
            if row.get("entity_id") not in visible:
                continue
            agent_id = agent_actions.agent_for(row)
            activity.append({
                **row,
                "action_type": "agent" if agent_id else "user",
                "agent_id": agent_id,
                "actor": AGENT_NAMES.get(agent_id, agent_id) if agent_id else "사용자",
                "description": describe_logbook(row, agent_id),
            })
        return JSONResponse(activity[-limit:])

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
        try:
            response = await ha.call_service(domain, service, forwarded)
        except httpx.HTTPError as e:
            log.warning("Home Assistant request failed: %r", e)
            return _message(status.HTTP_502_BAD_GATEWAY, "Home Assistant is unreachable")
        if response.is_success:
            agent_actions.add(who.id, entities, domain, service)
        return _ha_response(response)

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
