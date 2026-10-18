from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from support import DASHBOARD, ENV, HOME, ROOM1, bearer

import collector.main
from collector.events import TEXT_LIMIT
from collector.main import create_app
from common.hub import Hub
from homeconfig import load_config


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    with TestClient(create_app(load_config(env=ENV), str(tmp_path / "events.sqlite"))) as c:
        yield c


def received(**kw) -> dict:
    """room1's log line for a request Home delegated on behalf of Desktop (A2A-agents agent.ts)."""
    return {
        "ts": "2026-10-18T01:00:00.123Z",
        "agent": "room1",
        "dir": "in",
        "from": "orchestrator",
        "type": "device.control",
        "request_id": "scn-A1",
        "on_behalf_of": "desktop",
        "action": {"device": "input_select.room1_light_mode", "command": "SET", "value": "meeting"},
        "accepted": True,
        "reason_code": "OK",
        "message": "SET input_select.room1_light_mode=meeting",
        **kw,
    }


def post(client: TestClient, headers, body: dict) -> httpx.Response:
    return client.post("/events", json=body, headers=headers)


def events(client: TestClient) -> list[dict]:
    return client.get("/events", headers=DASHBOARD).json()


def test_requires_token(client):
    assert client.get("/health").status_code == 200
    assert client.post("/events", json=received()).status_code == 401
    assert post(client, bearer("nope"), received()).status_code == 401
    assert client.get("/events").status_code == 401


def test_stores_the_agents_own_log_line(client):
    assert post(client, ROOM1, received()).json() == {"id": 1}
    (stored,) = events(client)
    assert stored == {"id": 1, **received(ts="2026-10-18T01:00:00.123000Z")}


LINES = [
    {
        "dir": "out",
        "to": "room1",
        "type": "device.control",
        "request_id": "scn-A1",
        "action": {"device": "input_select.room1_light_mode", "command": "SET", "value": "meeting"},
    },
    {
        "dir": "out-result",
        "to": "room2",
        "type": "device.control",
        "accepted": False,
        "reason_code": "SAFETY_POLICY",
    },
    {"dir": "out-error", "to": "room2", "type": "device.control", "error": "fetch failed"},
    {
        "dir": "exec",
        "action": {"device": "input_boolean.living_tv_muted", "command": "TURN_ON"},
        "accepted": True,
        "reason_code": "OK",
    },
    {
        "dir": "rule",
        "rule": 'presence="AWAY"',
        "action": {"macro": "energy_saving"},
        "accepted": False,
        "reason_code": "PARTIAL",
    },
    {
        "dir": "in",
        "from": "?",  # unknown bearer token
        "type": "context.query",
        "fields": ["pc_state"],
        "accepted": False,
        "reason_code": "UNAUTHORIZED",
    },
]


@pytest.mark.parametrize("line", LINES)
def test_every_kind_of_log_line(client, line):
    body = {"ts": "2026-10-18T01:00:00Z", "agent": "orchestrator", **line}
    assert post(client, HOME, body).status_code == 201


def test_unknown_fields_are_dropped(client):
    # A future log field must never carry context values into the audit log.
    post(client, ROOM1, received(data={"meeting_title": "1:1 with boss"}, extra=1))
    (stored,) = events(client)
    assert "data" not in stored and "extra" not in stored


def test_long_text_is_cut(client):
    post(client, ROOM1, received(message="x" * 1000))
    assert len(events(client)[0]["message"]) == TEXT_LIMIT


def test_agent_must_report_as_itself(client):
    assert post(client, HOME, received()).status_code == 403


def test_dashboard_cannot_post(client):
    assert post(client, DASHBOARD, received(agent="dashboard")).status_code == 403


@pytest.mark.parametrize(
    "bad",
    [
        {"dir": "sideways"},
        {"from": None},  # `in` needs from
        {"dir": "out"},  # `out` needs to
        {"ts": "2026-10-18T01:00:00"},  # naive datetime
        {"reason_code": "ok"},
        {"accepted": "maybe"},
        {"fields": "pc_state"},
    ],
)
def test_invalid_event_rejected(client, bad):
    assert post(client, ROOM1, received(**bad)).status_code == 422


def test_get_pages_and_is_operator_only(client):
    for i in range(5):
        post(client, ROOM1, received(request_id=f"r{i}"))
    assert client.get("/events", headers=ROOM1).status_code == 403

    page = client.get("/events", params={"limit": 2}, headers=DASHBOARD).json()
    assert [e["id"] for e in page] == [1, 2]
    page = client.get("/events", params={"after_id": 2, "limit": 2}, headers=DASHBOARD).json()
    assert [(e["id"], e["request_id"]) for e in page] == [(3, "r2"), (4, "r3")]
    too_big = client.get("/events", params={"limit": 501}, headers=DASHBOARD)
    assert too_big.status_code == 422


def test_websocket_snapshot_then_live(client, monkeypatch):
    monkeypatch.setattr(collector.main, "SNAPSHOT_SIZE", 2)
    for i in range(3):
        post(client, ROOM1, received(request_id=f"r{i}"))

    with client.websocket_connect("/ws?token=t-dashboard") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot"
        assert [e["id"] for e in snap["events"]] == [2, 3]

        post(client, HOME, {"ts": "2026-10-18T01:00:00Z", "agent": "orchestrator", "dir": "exec"})
        msg = ws.receive_json()
        assert msg["type"] == "event"
        assert (msg["event"]["id"], msg["event"]["dir"]) == (4, "exec")
        assert "to" not in msg["event"]  # unset fields are left out


@pytest.mark.parametrize("query", ["", "?token=t-room1", "?token=nope"])
def test_websocket_is_operator_only(client, query):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws{query}") as ws:
            ws.receive_json()
    assert exc.value.code == 1008


async def test_hub_drops_subscriber_that_falls_behind():
    hub = Hub(queue_size=2)
    queue = hub.subscribe()
    for i in range(3):
        hub.publish({"id": i})
    assert queue.qsize() == 1 and queue.get_nowait() is None
    hub.publish({"id": 9})
    assert queue.empty()
