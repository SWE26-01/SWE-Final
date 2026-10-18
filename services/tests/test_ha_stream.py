import asyncio
import json

import pytest

from gateway.ha import StateStream, websocket_url

LIGHT = "input_boolean.room1_light"
HELLO = {"type": "auth_required", "ha_version": "2026.10.0"}
AUTH_OK = {"type": "auth_ok"}


def subscribed(request_id: int) -> dict:
    return {"id": request_id, "type": "result", "success": True, "result": None}


SUBSCRIPTIONS = [subscribed(request_id) for request_id in range(1, 5)]


def event(entity: str, event_type: str = "state_changed") -> dict:
    data = {"entity_id": entity, "old_state": None, "new_state": {"state": "on"}}
    return {
        "id": 1,
        "type": "event",
        "event": {"event_type": event_type, "data": data, "time_fired": "2026-10-18T01:00:00Z"},
    }


class FakeSocket:
    """One Home Assistant WebSocket session: replies to recv() in order, then closes."""

    def __init__(self, messages: list[dict]) -> None:
        self._messages = [json.dumps(m) for m in messages]
        self.sent: list[dict] = []

    async def __aenter__(self) -> "FakeSocket":
        return self

    async def __aexit__(self, *exc: object) -> None:
        pass

    async def recv(self) -> str:
        return self._messages.pop(0)

    async def send(self, raw: str) -> None:
        self.sent.append(json.loads(raw))

    def __aiter__(self) -> "FakeSocket":
        return self

    async def __anext__(self) -> str:
        if not self._messages:
            raise StopAsyncIteration  # server closed the connection
        return self._messages.pop(0)


class Sessions:
    """`connect` stand-in: each call returns the next session or raises the next error.
    When the script runs out it cancels the stream, which ends the test."""

    def __init__(self, *script: FakeSocket | Exception) -> None:
        self.script = list(script)
        self.urls: list[str] = []

    def __call__(self, url: str, **_: object) -> FakeSocket:
        self.urls.append(url)
        if not self.script:
            raise asyncio.CancelledError
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


async def follow(sessions: Sessions) -> list[tuple[str, object]]:
    calls: list[tuple[str, object]] = []

    async def on_connect() -> None:
        calls.append(("connect", None))

    async def on_change(data: dict, fired: str) -> None:
        calls.append(("change", data["entity_id"]))

    async def on_disconnect() -> None:
        calls.append(("disconnect", None))

    stream = StateStream(
        "http://ha.test:8123",
        "t-ha",
        {LIGHT},
        on_connect,
        on_change,
        on_disconnect,
        connect=sessions,
        retry=(0, 0),
    )
    with pytest.raises(asyncio.CancelledError):
        await stream.run()
    return calls


async def test_subscribes_and_forwards_only_home_devices():
    session = FakeSocket(
        [
            HELLO,
            AUTH_OK,
            *SUBSCRIPTIONS,
            event(LIGHT),
            event("person.me"),
            event(LIGHT, event_type="call_service"),
            {"id": 1, "type": "pong"},
        ]
    )
    calls = await follow(Sessions(session))
    assert session.sent == [
        {"type": "auth", "access_token": "t-ha"},
        {"id": 1, "type": "subscribe_events", "event_type": "state_changed"},
        {"id": 2, "type": "subscribe_events", "event_type": "entity_registry_updated"},
        {"id": 3, "type": "subscribe_events", "event_type": "device_registry_updated"},
        {"id": 4, "type": "subscribe_events", "event_type": "area_registry_updated"},
    ]
    assert calls == [("connect", None), ("change", LIGHT), ("disconnect", None)]


async def test_reconnects_after_failures():
    sessions = Sessions(
        OSError("connection refused"),
        FakeSocket([HELLO, {"type": "auth_invalid", "message": "Invalid access token"}]),
        FakeSocket([HELLO, AUTH_OK, {"id": 1, "type": "result", "success": False}]),
        FakeSocket([HELLO, AUTH_OK, *SUBSCRIPTIONS, event(LIGHT)]),
    )
    calls = await follow(sessions)
    assert len(sessions.urls) == 5  # four attempts, then the script cancels
    assert set(sessions.urls) == {"ws://ha.test:8123/api/websocket"}
    assert calls == [("connect", None), ("change", LIGHT), ("disconnect", None)]


def test_websocket_url():
    assert websocket_url("http://127.0.0.1:8123") == "ws://127.0.0.1:8123/api/websocket"
    assert websocket_url("https://ha.example/") == "wss://ha.example/api/websocket"
