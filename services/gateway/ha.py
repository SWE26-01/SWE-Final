"""Home Assistant access for the Gateway: REST calls and the state_changed event stream.

Only the Gateway holds the Home Assistant token (env HA_TOKEN).
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
from websockets.asyncio.client import connect as ws_connect

log = logging.getLogger(__name__)

State = dict[str, Any]  # HA state object: {entity_id, state, attributes, last_changed, ...}


class HomeAssistant:
    """REST client. Responses are returned as-is so the Gateway can pass them through."""

    def __init__(
        self,
        url: str,
        token: str,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 5.0,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
            transport=transport,
        )

    async def get_state(self, entity: str) -> httpx.Response:
        return await self._http.get(f"/api/states/{entity}")

    async def call_service(self, domain: str, service: str, body: dict[str, Any]) -> httpx.Response:
        return await self._http.post(f"/api/services/{domain}/{service}", json=body)

    async def states(self) -> list[State]:
        resp = await self._http.get("/api/states")
        resp.raise_for_status()
        return resp.json()

    async def aclose(self) -> None:
        await self._http.aclose()


def websocket_url(ha_url: str) -> str:
    """http://host:8123 -> ws://host:8123/api/websocket (https -> wss)."""
    scheme, rest = ha_url.split("://", 1)
    return f"{'wss' if scheme == 'https' else 'ws'}://{rest.rstrip('/')}/api/websocket"


class AuthFailed(Exception):
    pass


class StateStream:
    """Follows Home Assistant's `state_changed` events and reconnects forever.

    After every (re)connect `on_connect()` runs, so the owner can reload full state for anything
    missed while disconnected. `on_change(event_data, time_fired)` then gets each change of an
    entity in `entities`. `connected` tells whether the stream is currently live."""

    def __init__(
        self,
        ha_url: str,
        token: str,
        entities: set[str],
        on_connect: Callable[[], Awaitable[None]],
        on_change: Callable[[dict[str, Any], str], Awaitable[None]],
        on_disconnect: Callable[[], Awaitable[None]] | None = None,
        connect: Callable[..., Any] = ws_connect,
        retry: tuple[float, float] = (1.0, 30.0),
    ) -> None:
        self._url = websocket_url(ha_url)
        self._token = token
        self._entities = entities
        self._on_connect = on_connect
        self._on_change = on_change
        self._on_disconnect = on_disconnect
        self._connect = connect
        self._retry = retry
        self.connected = False

    async def run(self) -> None:
        delay = self._retry[0]
        while True:
            try:
                async with self._connect(self._url, max_size=2**22) as ws:
                    await self._subscribe(ws)
                    self.connected = True
                    delay = self._retry[0]
                    await self._on_connect()
                    async for raw in ws:
                        await self._handle(json.loads(raw))
                log.warning("Home Assistant event stream closed; reconnecting")
            except asyncio.CancelledError:
                raise
            except AuthFailed as e:
                log.error("Home Assistant rejected the token (HA_TOKEN): %s", e)
                delay = self._retry[1]
            except Exception as e:  # unreachable, closed, bad message: retry the same way
                log.warning("Home Assistant event stream: %r", e)
            if self.connected:
                self.connected = False
                if self._on_disconnect is not None:
                    await self._on_disconnect()
            await asyncio.sleep(delay)
            delay = min(delay * 2, self._retry[1])

    async def _subscribe(self, ws: Any) -> None:
        hello = json.loads(await ws.recv())
        if hello.get("type") != "auth_required":
            raise ConnectionError(f"unexpected first message {hello.get('type')!r}")
        await ws.send(json.dumps({"type": "auth", "access_token": self._token}))
        answer = json.loads(await ws.recv())
        if answer.get("type") != "auth_ok":
            raise AuthFailed(answer.get("message", answer.get("type")))
        subscribe = {"id": 1, "type": "subscribe_events", "event_type": "state_changed"}
        await ws.send(json.dumps(subscribe))
        result = json.loads(await ws.recv())
        if result.get("type") != "result" or not result.get("success"):
            raise ConnectionError(f"subscribe_events failed: {result}")

    async def _handle(self, msg: dict[str, Any]) -> None:
        if msg.get("type") != "event":
            return
        event = msg.get("event", {})
        data = event.get("data", {})
        if event.get("event_type") == "state_changed" and data.get("entity_id") in self._entities:
            await self._on_change(data, event.get("time_fired", ""))
