import asyncio
import logging
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import collector.main
from collector.client import EventReporter
from collector.events import AgentEvent
from collector.main import Hub, create_app
from homeconfig import load_config

MY_ROOM = "dev-my-room-user1"
HOME = "dev-home-agent"
DASHBOARD = "dev-dashboard"


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(load_config(), str(tmp_path / "events.sqlite"))) as c:
        yield c


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def event(agent: str = "my-room-user1", **kw) -> dict:
    return {
        "at": "2026-10-17T10:00:00+09:00",
        "agent": agent,
        "kind": "a2a.sent",
        "peer": "home-agent",
        "message_type": "device.control",
        "request_id": "r1",
        **kw,
    }


def post(client: TestClient, token: str, body: dict) -> httpx.Response:
    return client.post("/events", json=body, headers=auth(token))


def test_requires_token(client):
    assert client.get("/health").status_code == 200
    assert client.post("/events", json=event()).status_code == 401
    assert post(client, "nope", event()).status_code == 401
    assert client.get("/events").status_code == 401


def test_agent_posts_own_event(client):
    r = post(client, MY_ROOM, event(summary="meeting mode: vacuum stop"))
    assert r.status_code == 201
    assert r.json() == {"id": 1}
    decision = event("home-agent", kind="policy.decision", peer=None, message_type=None)
    r = post(client, HOME, {**decision, "accepted": False, "reason_code": "OCCUPIED"})
    assert r.json() == {"id": 2}


def test_agent_must_report_as_itself(client):
    r = post(client, HOME, event("my-room-user1"))
    assert r.status_code == 403


def test_dashboard_cannot_post(client):
    assert post(client, DASHBOARD, event("dashboard")).status_code == 403


@pytest.mark.parametrize(
    "bad",
    [
        {"data": {"title": "1:1 with boss"}},  # no free-form payload: raw data would leak
        {"summary": "x" * 201},
        {"kind": "a2a.leaked"},
        {"message_type": "calendar.event"},
        {"task_state": "completed"},  # A2A v0.3 name
        {"peer": None},  # a2a.* events need a peer
        {"at": "2026-10-17T10:00:00"},  # naive datetime
    ],
)
def test_invalid_event_rejected(client, bad):
    assert post(client, MY_ROOM, event(**bad)).status_code == 422


def test_unknown_peer_rejected(client):
    assert post(client, MY_ROOM, event(peer="ghost")).status_code == 422


def test_get_pages_and_is_operator_only(client):
    for i in range(5):
        post(client, MY_ROOM, event(request_id=f"r{i}"))
    assert client.get("/events", headers=auth(MY_ROOM)).status_code == 403

    page = client.get("/events", params={"limit": 2}, headers=auth(DASHBOARD)).json()
    assert [e["id"] for e in page] == [1, 2]
    page = client.get("/events", params={"after_id": 2, "limit": 2}, headers=auth(DASHBOARD))
    assert [(e["id"], e["request_id"]) for e in page.json()] == [(3, "r2"), (4, "r3")]
    assert page.json()[0]["agent"] == "my-room-user1"
    too_big = client.get("/events", params={"limit": 501}, headers=auth(DASHBOARD))
    assert too_big.status_code == 422


def test_websocket_snapshot_then_live(client, monkeypatch):
    monkeypatch.setattr(collector.main, "SNAPSHOT_SIZE", 2)
    for i in range(3):
        post(client, MY_ROOM, event(request_id=f"r{i}"))

    with client.websocket_connect(f"/ws?token={DASHBOARD}") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot"
        assert [e["id"] for e in snap["events"]] == [2, 3]

        fired = event("home-agent", kind="automation.fired", peer=None, message_type=None)
        post(client, HOME, fired)
        msg = ws.receive_json()
        assert msg["type"] == "event"
        assert msg["event"]["id"] == 4
        assert msg["event"]["kind"] == "automation.fired"
        assert "peer" not in msg["event"]  # unset fields are left out


@pytest.mark.parametrize("query", ["", f"?token={MY_ROOM}", "?token=nope"])
def test_websocket_is_operator_only(client, query):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws{query}") as ws:
            ws.receive_json()
    assert exc.value.code == 1008


def test_hub_drops_subscriber_that_falls_behind(monkeypatch):
    monkeypatch.setattr(collector.main, "QUEUE_SIZE", 2)
    hub = Hub()
    queue = hub.subscribe()
    for i in range(3):
        hub.publish({"id": i})
    assert queue.qsize() == 1 and queue.get_nowait() is None
    hub.publish({"id": 9})
    assert queue.empty()


async def test_reporter_end_to_end(tmp_path):
    app = create_app(load_config(), str(tmp_path / "events.sqlite"))
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with EventReporter("http://collector", MY_ROOM, transport=transport) as reporter:
            await reporter.report(AgentEvent.model_validate(event()))
        async with httpx.AsyncClient(transport=transport, base_url="http://collector") as http:
            events = (await http.get("/events", headers=auth(DASHBOARD))).json()
    assert [(e["id"], e["agent"], e["request_id"]) for e in events] == [(1, "my-room-user1", "r1")]


async def test_reporter_swallows_collector_down(caplog):
    reporter = EventReporter("http://127.0.0.1:9", MY_ROOM, timeout=1.0)  # nothing listens here
    with caplog.at_level(logging.WARNING, logger="collector.client"):
        await asyncio.wait_for(reporter.report(AgentEvent.model_validate(event())), 5)
    await reporter.aclose()
    assert "event not recorded" in caplog.text


async def test_reporter_swallows_rejection(caplog):
    transport = httpx.MockTransport(lambda request: httpx.Response(403))
    reporter = EventReporter("http://collector", HOME, transport=transport)
    with caplog.at_level(logging.WARNING, logger="collector.client"):
        await reporter.report(AgentEvent.model_validate(event()))
    await reporter.aclose()
    assert "event not recorded" in caplog.text
