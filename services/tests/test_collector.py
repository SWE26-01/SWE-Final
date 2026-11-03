import json
import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from support import COACH, CONFIG, DASHBOARD, ENV, HOME, bearer

import collector.main
from collector.events import TEXT_LIMIT
from collector.main import create_app
from common.hub import Hub
from homeconfig import load_config

# Message types and reason codes in these tests are examples; Home-A2A will define the real ones.
BRIGHTNESS = "input_number.living_light_brightness"
AC_TARGET = "input_number.living_ac_target"
DIM = {"device": BRIGHTNESS, "command": "SET", "value": 80}
TOKENS = {"home": HOME, "coach": COACH}


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(load_config(CONFIG, ENV), str(tmp_path / "events.sqlite"), watch_agents=False)
    with TestClient(app) as c:
        yield c


def received(**kw) -> dict:
    """Home's log line for the workout coach's request to change the light."""
    return {
        "ts": "2026-10-18T01:00:00.123Z",
        "agent": "home",
        "dir": "in",
        "from": "coach",
        "type": "environment.request",
        "request_id": "scn-A1",
        "action": DIM,
        "accepted": True,
        "reason_code": "OK",
        "message": f"SET {BRIGHTNESS}=80",
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
    assert post(client, HOME, received()).json() == {"id": 1}
    (stored,) = events(client)
    received_at = datetime.fromisoformat(stored.pop("received_at"))  # the Collector's own clock
    assert before <= received_at <= datetime.now(UTC)
    assert stored == {"id": 1, "flow": "scn-A1", **received(ts="2026-10-18T01:00:00.123000Z")}


LINES = [
    {
        "agent": "coach",
        "dir": "out",
        "to": "home",
        "type": "environment.request",
        "request_id": "scn-A1",
        "action": DIM,
    },
    {
        "agent": "coach",
        "dir": "out-result",
        "to": "home",
        "type": "environment.request",
        "accepted": False,
        "reason_code": "DEVICE_IN_USE",
    },
    {"agent": "coach", "dir": "out-error", "to": "home", "error": "connection refused"},
    {
        "agent": "home",
        "dir": "exec",
        "action": DIM,
        "on_behalf_of": "coach",
        "accepted": True,
        "reason_code": "OK",
    },
    {"agent": "coach", "dir": "rule", "rule": "occupancy=false", "accepted": True},
    {
        "agent": "home",
        "dir": "in",
        "from": "?",  # unknown bearer token
        "type": "state.subscribe",
        "fields": ["occupancy"],
        "accepted": False,
        "reason_code": "UNAUTHORIZED",
    },
]


@pytest.mark.parametrize("line", LINES)
def test_every_kind_of_log_line(client, line):
    body = {"ts": "2026-10-18T01:00:00Z", **line}
    assert post(client, TOKENS[line["agent"]], body).status_code == 201


def test_unknown_fields_are_dropped(client):
    # A future log field must never carry personal data into the audit log.
    post(client, HOME, received(data={"heart_rate": 142}, extra=1))
    (stored,) = events(client)
    assert "data" not in stored and "extra" not in stored


def test_long_text_is_cut(client):
    post(client, HOME, received(message="x" * 1000))
    assert len(events(client)[0]["message"]) == TEXT_LIMIT


def test_agent_must_report_as_itself(client):
    assert post(client, COACH, received()).status_code == 403


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
        {"fields": "occupancy"},
    ],
)
def test_invalid_event_rejected(client, bad):
    assert post(client, HOME, received(**bad)).status_code == 422


def test_get_pages_and_is_operator_only(client):
    for i in range(5):
        post(client, HOME, received(request_id=f"r{i}"))
    assert client.get("/events", headers=HOME).status_code == 403

    page = client.get("/events", params={"limit": 2}, headers=DASHBOARD).json()
    assert [e["id"] for e in page] == [1, 2]
    page = client.get("/events", params={"after_id": 2, "limit": 2}, headers=DASHBOARD).json()
    assert [(e["id"], e["request_id"]) for e in page] == [(3, "r2"), (4, "r3")]
    too_big = client.get("/events", params={"limit": 501}, headers=DASHBOARD)
    assert too_big.status_code == 422


def test_websocket_snapshot_then_live(client, monkeypatch):
    monkeypatch.setattr(collector.main, "SNAPSHOT_SIZE", 2)
    for i in range(3):
        post(client, HOME, received(request_id=f"r{i}"))

    with client.websocket_connect("/ws?token=t-dashboard") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot"
        assert [e["id"] for e in snap["events"]] == [2, 3]

        post(client, HOME, {"ts": "2026-10-18T01:00:00Z", "agent": "home", "dir": "exec"})
        msg = ws.receive_json()
        assert msg["type"] == "event"
        assert (msg["event"]["id"], msg["event"]["dir"]) == (4, "exec")
        assert "to" not in msg["event"]  # unset fields are left out


@pytest.mark.parametrize("query", ["", "?token=t-home", "?token=nope"])
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


RESTORE = {"command": "RESTORE"}

# What the agents log, in order, for three requests:
SCENARIO = [
    # The coach asks Home to change the light for the workout; Home does it for the coach.
    line("coach", "out", "req-1", 1, to="home", type="environment.request", action=DIM),
    line("home", "exec", "req-1", 2, action=DIM, on_behalf_of="coach", accepted=True,
         reason_code="OK"),
    line("home", "in", "req-1", 2, **{"from": "coach"}, type="environment.request", action=DIM,
         accepted=True, reason_code="OK"),
    line("coach", "out-result", "req-1", 3, to="home", type="environment.request", accepted=True,
         reason_code="OK"),
    # State updates carry no request_id and belong to no flow.
    line("coach", "in", None, 4, **{"from": "home"}, type="state.update", fields=["occupancy"],
         accepted=True),
    # Session end: Home restores each device the session changed (`<id>/<device>`); the user set
    # the AC by hand meanwhile, so that one stays.
    line("coach", "out", "req-2", 5, to="home", type="environment.restore", action=RESTORE),
    line("home", "exec", "req-2/brightness", 6, action=DIM | {"value": 50}, accepted=True,
         reason_code="OK"),
    line("home", "exec", "req-2/ac", 6, action={"device": AC_TARGET, "command": "SET", "value": 26},
         accepted=False, reason_code="USER_CHANGED"),
    line("home", "in", "req-2", 7, **{"from": "coach"}, type="environment.restore", action=RESTORE,
         accepted=False, reason_code="PARTIAL"),
    # A rule the coach fired by itself: the user left, so it paused the session.
    line("coach", "rule", "r-3", 8, rule="occupancy=false", accepted=True, reason_code="OK"),
]


def play(client: TestClient) -> None:
    for body in SCENARIO:
        assert post(client, TOKENS[body["agent"]], body).status_code == 201


def test_flows_follow_requests_across_agents(client):
    play(client)
    flows = client.get("/flows", headers=DASHBOARD).json()
    assert [f["flow"] for f in flows] == ["r-3", "req-2", "req-1"]  # most recent first
    rule, restore, dimmed = flows

    assert dimmed["requester"] == "coach" and dimmed["entry"] == "home"
    assert dimmed["agents"] == ["coach", "home"]
    assert (dimmed["events"], dimmed["accepted"], dimmed["reason_code"]) == (4, True, "OK")
    assert dimmed["action"]["device"] == BRIGHTNESS
    assert dimmed["started_at"] == "2026-10-18T01:00:01Z"

    assert (restore["requester"], restore["entry"]) == ("coach", "home")
    assert restore["agents"] == ["coach", "home"]
    assert (restore["accepted"], restore["reason_code"]) == (False, "PARTIAL")

    assert (rule["requester"], rule["entry"], rule["accepted"]) == ("coach", "coach", True)

    assert len(client.get("/flows", params={"limit": 1}, headers=DASHBOARD).json()) == 1


def test_flow_detail_and_events_carry_their_flow(client):
    play(client)
    detail = client.get("/flows/req-2", headers=DASHBOARD).json()
    assert detail["flow"]["flow"] == "req-2"
    ids = [e["request_id"] for e in detail["events"]]
    assert ids == ["req-2", "req-2/brightness", "req-2/ac", "req-2"]
    assert client.get("/flows/nope", headers=DASHBOARD).status_code == 404
    flows_of = {e["id"]: e.get("flow") for e in events(client)}
    assert flows_of[5] is None and flows_of[7] == "req-2"


def test_flows_are_operator_only(client):
    assert client.get("/flows", headers=HOME).status_code == 403
    assert client.get("/flows/req-1", headers=HOME).status_code == 403
    assert client.get("/flows").status_code == 401


def test_old_database_gets_flows(tmp_path):
    db = tmp_path / "old.sqlite"
    conn = sqlite3.connect(db)  # schema before flows existed
    with conn:
        conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT)")
        for body in SCENARIO[:4]:
            conn.execute("INSERT INTO events (json) VALUES (?)", (json.dumps(body),))
    conn.close()
    with TestClient(create_app(load_config(CONFIG, ENV), str(db), watch_agents=False)) as c:
        (flow,) = c.get("/flows", headers=DASHBOARD).json()
        assert (flow["flow"], flow["events"], flow["requester"]) == ("req-1", 4, "coach")
        old = events(c)
        assert all("received_at" not in e for e in old)  # arrival time was never recorded
        assert post(c, HOME, received()).status_code == 201
        assert "received_at" in events(c)[-1]


def test_flow_follows_event_time_not_arrival(client):
    # Agents post concurrently, so lines can arrive out of order: here the coach's result and
    # Home's answer arrive before Home's execution.
    at = {1: "01:00:02.100", 2: "01:00:02.500", 3: "01:00:03.100"}  # real lines have ms
    timed = [b | {"ts": f"2026-10-18T{at[i]}Z"} if i in at else b for i, b in enumerate(SCENARIO)]
    late = [timed[3], timed[0], timed[2], timed[1]]
    for body in late:
        assert post(client, TOKENS[body["agent"]], body).status_code == 201
    detail = client.get("/flows/req-1", headers=DASHBOARD).json()
    order = [(e["agent"], e["dir"]) for e in detail["events"]]
    assert order == [("coach", "out"), ("home", "exec"), ("home", "in"), ("coach", "out-result")]
    summary = detail["flow"]
    assert (summary["requester"], summary["entry"]) == ("coach", "home")
    assert (summary["first_id"], summary["last_id"]) == (1, 4)
    assert summary["started_at"] == "2026-10-18T01:00:01Z"


def test_collector_cors_only_for_configured_origins(tmp_path):
    env = {**ENV, "AMBIENT_CORS_ORIGINS": "http://localhost:5173"}
    app = create_app(load_config(CONFIG, env), str(tmp_path / "e.sqlite"), watch_agents=False)
    with TestClient(app) as c:
        r = c.get("/flows", headers={**DASHBOARD, "Origin": "http://localhost:5173"})
        assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
        r = c.get("/flows", headers={**DASHBOARD, "Origin": "http://evil.test"})
        assert "access-control-allow-origin" not in r.headers
