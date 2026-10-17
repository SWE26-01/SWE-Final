"""Virtual Device Gateway (WBS W8). Source of truth for device and space state.

Agents call it over REST with `Authorization: Bearer <token>` (config/agents.yaml).
The dashboard (operator) listens on `WebSocket /ws?token=<token>`; events follow
contracts/gateway/events.schema.json.

Run: uvicorn gateway.main:app --port 8100
"""

import asyncio
import contextlib
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import Body, Depends, FastAPI, HTTPException, Request, WebSocket, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from starlette.websockets import WebSocketDisconnect

from gateway.state import GatewayError, GatewayState, InputEvent
from homeconfig import HomeConfig, load_config
from homeconfig.models import Agent, AgentRole

HOME_AGENT = "home-agent"  # coordinates the whole home, so it may read every space


class CommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(min_length=1)
    command: str
    params: dict[str, Any] = Field(default_factory=dict)


class Broadcaster:
    """Operator WebSocket connections. One lock keeps the snapshot and later events in order."""

    def __init__(self) -> None:
        self._sockets: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def join(self, ws: WebSocket, snapshot: Callable[[], dict[str, Any]]) -> None:
        async with self._lock:
            await ws.send_json(snapshot())
            self._sockets.add(ws)

    def leave(self, ws: WebSocket) -> None:
        self._sockets.discard(ws)

    async def send(self, event: dict[str, Any]) -> None:
        async with self._lock:
            for ws in list(self._sockets):
                try:
                    await ws.send_json(event)
                except Exception:  # client went away; drop it
                    self._sockets.discard(ws)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def create_app(config: HomeConfig) -> FastAPI:
    """Build a Gateway with fresh state from `config`."""
    state = GatewayState(config)
    clients = Broadcaster()
    bearer = HTTPBearer(auto_error=False)

    app = FastAPI(title="Virtual Device Gateway")
    app.state.gateway = state

    @app.exception_handler(GatewayError)
    async def gateway_error(_: Request, exc: GatewayError) -> JSONResponse:
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    def caller(
        cred: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    ) -> Agent:
        agent = config.agent_by_token(cred.credentials) if cred else None
        if agent is None or not agent.enabled:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "missing or unknown bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return agent

    def operator(agent: Annotated[Agent, Depends(caller)]) -> Agent:
        if agent.role is not AgentRole.OPERATOR:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "operator only")
        return agent

    Caller = Annotated[Agent, Depends(caller)]
    Operator = Annotated[Agent, Depends(operator)]

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True}

    @app.get("/devices")
    async def list_devices(_: Caller) -> list[dict]:
        return state.device_views()

    @app.post("/devices/{device_id}/commands")
    async def run_command(device_id: str, body: CommandRequest, agent: Caller) -> dict:
        device = config.devices.get(device_id)
        if device is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown device {device_id!r}")
        # Owner agents decide; the Gateway checks ownership again. Operators own nothing.
        if device.owner != agent.id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"{device_id!r} is owned by {device.owner!r}; send device.control to it",
            )
        # TODO(W8-2): high-impact commands must carry a valid approval token
        #   (reject a mismatched or expired token) before they are applied.
        result, changed = state.command(
            agent.id, device_id, body.request_id, body.command, body.params
        )
        if changed:
            await clients.send(
                {
                    "type": "device.state_changed",
                    "at": _now(),
                    "device": device_id,
                    "state": result["state"],
                    "by": agent.id,
                }
            )
        return result

    @app.get("/spaces/{space_id}")
    async def get_space(space_id: str, agent: Caller) -> dict:
        if space_id not in config.spaces:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown space {space_id!r}")
        if not (
            agent.role is AgentRole.OPERATOR
            or agent.id == HOME_AGENT
            or space_id in agent.owned_spaces
        ):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"{agent.id!r} cannot read {space_id!r}")
        return state.space_view(space_id)

    @app.post("/inputs")
    async def post_input(event: Annotated[InputEvent, Body()], agent: Operator) -> dict:
        """Scenario replay / sensor input: person.moved or sensor.changed."""
        changed = state.apply_input(event)
        for space_id in changed:
            await clients.send(
                {
                    "type": "space.state_changed",
                    "at": _now(),
                    "space": space_id,
                    "state": state.space_state(space_id),
                    "by": agent.id,
                }
            )
        return {"spaces": [state.space_view(s) for s in changed]}

    @app.websocket("/ws")
    async def events(ws: WebSocket) -> None:
        # Browsers cannot set headers on WebSocket, so the token comes in the query string.
        agent = config.agent_by_token(ws.query_params.get("token", ""))
        if agent is None or not agent.enabled or agent.role is not AgentRole.OPERATOR:
            await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        await ws.accept()
        try:
            with contextlib.suppress(WebSocketDisconnect):
                await clients.join(ws, state.snapshot)
                while (await ws.receive())["type"] != "websocket.disconnect":
                    pass  # client messages are ignored
        finally:
            clients.leave(ws)

    # TODO(W8-3): POST /scenarios/{id}/run

    return app


app = create_app(load_config())
