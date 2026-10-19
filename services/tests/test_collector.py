import json
import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime
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
    app = create_app(load_config(env=ENV), str(tmp_path / "events.sqlite"), watch_agents=False)
    with TestClient(app) as c:
        yield c


def received(**kw) -> dict:
    """room1's log line (agents/ambient-a2a-plugin/src/agent.ts `log()`) for a request Home
    delegated on behalf of Desktop."""
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
    before = datetime.now(UTC)
    assert post(client, ROOM1, received()).json() == {"id": 1}
    (stored,) = events(client)
    received_at = datetime.fromisoformat(stored.pop("received_at"))  # the Collector's own clock
    assert before <= received_at <= datetime.now(UTC)
    assert stored == {"id": 1, "flow": "scn-A1", **received(ts="2026-10-18T01:00:00.123000Z")}


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


# --- flows: one request followed across agents -----------------------------------------------


def line(agent: str, dir: str, rid: str | None, at: int, **kw) -> dict:
    body = {"ts": f"2026-10-18T01:00:{at:02d}Z", "agent": agent, "dir": dir, **kw}
    return body | ({"request_id": rid} if rid else {})


TOKENS = {"orchestrator": HOME, "room1": ROOM1, "room2": bearer("t-room2")}
LIGHT_MODE = {"device": "input_select.room1_light_mode", "command": "SET", "value": "meeting"}
SAVE = {"command": "ENERGY_SAVING"}

# What the agents log, in order, for three requests (agents/ambient-a2a-plugin/src/agent.ts):
SCENARIO = [
    # Desktop asks Home for room1's light mode; Home delegates and room1 executes.
    line("orchestrator", "out", "req-1", 1, to="room1", type="device.control", action=LIGHT_MODE),
    line("room1", "exec", "req-1", 2, action=LIGHT_MODE, accepted=True, reason_code="OK"),
    line("room1", "in", "req-1", 2, **{"from": "orchestrator"}, type="device.control",
         on_behalf_of="desktop", action=LIGHT_MODE, accepted=True, reason_code="OK"),
    line("orchestrator", "out-result", "req-1", 3, to="room1", type="device.control",
         accepted=True, reason_code="OK"),
    line("orchestrator", "in", "req-1", 3, **{"from": "desktop"}, type="device.control",
         action=LIGHT_MODE, accepted=True, reason_code="OK"),
    # Context updates carry no request_id and belong to no flow.
    line("room1", "in", None, 4, **{"from": "desktop"}, type="context.update", accepted=True),
    # Energy saving: each room gets `<id>/<room>`; room2 keeps its AC on.
    line("room2", "in", "req-2/room2", 5, **{"from": "orchestrator"}, type="device.control",
         action=SAVE, accepted=False, reason_code="PARTIAL"),
    line("room1", "in", "req-2/room1", 5, **{"from": "orchestrator"}, type="device.control",
         action=SAVE, accepted=True, reason_code="OK"),
    line("orchestrator", "in", "req-2", 6, **{"from": "desktop"}, type="device.control",
         action=SAVE, accepted=False, reason_code="PARTIAL"),
    # A rule room1 fired by itself.
    line("room1", "exec", "r-3", 7, action=LIGHT_MODE, accepted=True, reason_code="OK"),
    line("room1", "rule", "r-3", 7, rule="meeting_app_active=true", action=LIGHT_MODE,
         accepted=True, reason_code="OK"),
]


def play(client: TestClient) -> None:
    for body in SCENARIO:
        assert post(client, TOKENS[body["agent"]], body).status_code == 201


def test_flows_follow_requests_across_agents(client):
    play(client)
    flows = client.get("/flows", headers=DASHBOARD).json()
    assert [f["flow"] for f in flows] == ["r-3", "req-2", "req-1"]  # most recent first
    rule, saving, delegated = flows

    assert delegated["requester"] == "desktop" and delegated["entry"] == "orchestrator"
    assert delegated["agents"] == ["orchestrator", "room1"]
    assert (delegated["events"], delegated["accepted"], delegated["reason_code"]) == (5, True, "OK")
    assert delegated["action"]["device"] == "input_select.room1_light_mode"
    assert delegated["started_at"] == "2026-10-18T01:00:01Z"

    assert (saving["requester"], saving["entry"]) == ("desktop", "orchestrator")
    assert saving["agents"] == ["room2", "room1", "orchestrator"]
    assert (saving["accepted"], saving["reason_code"]) == (False, "PARTIAL")

    assert (rule["requester"], rule["entry"], rule["accepted"]) == ("room1", "room1", True)

    assert len(client.get("/flows", params={"limit": 1}, headers=DASHBOARD).json()) == 1


def test_flow_detail_and_events_carry_their_flow(client):
    play(client)
    detail = client.get("/flows/req-2", headers=DASHBOARD).json()
    assert detail["flow"]["flow"] == "req-2"
    assert [e["request_id"] for e in detail["events"]] == ["req-2/room2", "req-2/room1", "req-2"]
    assert client.get("/flows/nope", headers=DASHBOARD).status_code == 404
    flows_of = {e["id"]: e.get("flow") for e in events(client)}
    assert flows_of[6] is None and flows_of[7] == "req-2"


def test_flows_are_operator_only(client):
    assert client.get("/flows", headers=ROOM1).status_code == 403
    assert client.get("/flows/req-1", headers=ROOM1).status_code == 403
    assert client.get("/flows").status_code == 401


def test_old_database_gets_flows(tmp_path):
    db = tmp_path / "old.sqlite"
    conn = sqlite3.connect(db)  # schema before flows existed
    with conn:
        conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT)")
        for body in SCENARIO[:5]:
            conn.execute("INSERT INTO events (json) VALUES (?)", (json.dumps(body),))
    conn.close()
    with TestClient(create_app(load_config(env=ENV), str(db), watch_agents=False)) as c:
        (flow,) = c.get("/flows", headers=DASHBOARD).json()
        assert (flow["flow"], flow["events"], flow["requester"]) == ("req-1", 5, "desktop")
        old = events(c)
        assert all("received_at" not in e for e in old)  # arrival time was never recorded
        assert post(c, ROOM1, received()).status_code == 201
        assert "received_at" in events(c)[-1]


def test_flow_follows_event_time_not_arrival(client):
    # Agents post concurrently, so lines can arrive out of order: here Home's final answer and
    # room1's execution arrive before room1's own answer.
    at = {2: "01:00:02.500", 3: "01:00:03.100", 4: "01:00:03.900"}  # real lines have ms
    timed = [b | {"ts": f"2026-10-18T{at[i]}Z"} if i in at else b for i, b in enumerate(SCENARIO)]
    late = [timed[4], timed[0], timed[2], timed[3], timed[1]]
    for body in late:
        assert post(client, TOKENS[body["agent"]], body).status_code == 201
    detail = client.get("/flows/req-1", headers=DASHBOARD).json()
    order = [(e["agent"], e["dir"]) for e in detail["events"]]
    assert order == [
        ("orchestrator", "out"),
        ("room1", "exec"),
        ("room1", "in"),
        ("orchestrator", "out-result"),
        ("orchestrator", "in"),
    ]
    summary = detail["flow"]
    assert (summary["requester"], summary["entry"]) == ("desktop", "orchestrator")
    assert (summary["first_id"], summary["last_id"]) == (1, 5)
    assert summary["started_at"] == "2026-10-18T01:00:01Z"


def test_collector_cors_only_for_configured_origins(tmp_path):
    env = {**ENV, "AMBIENT_CORS_ORIGINS": "http://localhost:5173"}
    app = create_app(load_config(env=env), str(tmp_path / "e.sqlite"), watch_agents=False)
    with TestClient(app) as c:
        r = c.get("/flows", headers={**DASHBOARD, "Origin": "http://localhost:5173"})
        assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
        r = c.get("/flows", headers={**DASHBOARD, "Origin": "http://evil.test"})
        assert "access-control-allow-origin" not in r.headers
