import logging
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from support import DASHBOARD, ENV, ROOM1

from collector.agents import AgentWatcher
from collector.main import create_app
from common.logs import HideTokens, hide_token
from homeconfig import load_config

EXT = "https://github.com/nsu102/A2A-agents/spec/ambient-a2a/v1"


def card(role: str, owned: list[str]) -> dict:
    params = {"role": role, "space": "my_room", "owned_devices": owned, "provided_fields": []}
    return {"name": "x", "capabilities": {"extensions": [{"uri": EXT, "params": params}]}}


class FakeAgents:
    """Agent Card endpoints; agents in `down` refuse connections."""

    def __init__(self) -> None:
        self.down = {"room2"}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        port = request.url.port
        agent = {18800: "desktop", 18920: "smartphone", 19040: "orchestrator", 19160: "room1"}.get(
            port, "room2"
        )
        if agent in self.down:
            raise httpx.ConnectError("refused")
        if agent == "room1":
            return httpx.Response(200, json=card("room", ["input_boolean.room1_light"]))
        return httpx.Response(200, json=card("external", []))


async def test_watcher_reports_up_down_and_changes():
    agents = FakeAgents()
    calls = []
    config = load_config(env=ENV)
    watcher = AgentWatcher(config.agents(), lambda: calls.append(1), httpx.MockTransport(agents))
    assert await watcher.check_once() is True  # first check: four agents came up
    room1, room2 = watcher.statuses["room1"], watcher.statuses["room2"]
    assert (room1.online, room1.role) == (True, "room")
    assert room1.owned_devices == ["input_boolean.room1_light"]
    assert (room2.online, room2.checked_at is not None) == (False, True)

    assert await watcher.check_once() is False  # nothing changed but the check time
    agents.down = {"desktop"}
    assert await watcher.check_once() is True
    assert watcher.statuses["room2"].online and not watcher.statuses["desktop"].online


def wait_for_first_check(client: TestClient) -> list[dict]:
    for _ in range(50):
        agents = client.get("/agents", headers=DASHBOARD).json()
        if all(a["checked_at"] for a in agents):
            return agents
        time.sleep(0.05)
    raise AssertionError("agents were never checked")


@pytest.fixture
def client(tmp_path: Path):
    app = create_app(
        load_config(env=ENV),
        str(tmp_path / "events.sqlite"),
        agent_transport=httpx.MockTransport(FakeAgents()),
    )
    with TestClient(app) as c:
        yield c


def test_agents_endpoint_and_snapshot(client):
    agents = wait_for_first_check(client)
    assert [a["id"] for a in agents] == ["desktop", "smartphone", "orchestrator", "room1", "room2"]
    assert {a["id"]: a["online"] for a in agents}["room2"] is False

    event = {"ts": "2026-10-18T01:00:00Z", "agent": "room1", "dir": "exec", "accepted": True}
    assert client.post("/events", json=event, headers=ROOM1).status_code == 201
    room1 = next(a for a in client.get("/agents", headers=DASHBOARD).json() if a["id"] == "room1")
    assert (room1["events"], room1["last_event_at"]) == (1, "2026-10-18T01:00:00Z")

    with client.websocket_connect("/ws?token=t-dashboard") as ws:
        snapshot = ws.receive_json()
        offline = [a["id"] for a in snapshot["agents"] if not a["online"]]
        assert (len(snapshot["agents"]), offline) == (5, ["room2"])

    assert client.get("/agents", headers=ROOM1).status_code == 403


def test_agents_host_for_services_in_docker():
    env = {**ENV, "AMBIENT_AGENTS_HOST": "host.docker.internal"}
    urls = {a.id: a.url for a in load_config(env=env).agents()}
    assert urls["room1"] == "http://host.docker.internal:19160/plugins/ambient"
    assert {a.id: a.url for a in load_config(env=ENV).agents()}["room1"].startswith("http://127.0.0.1")


def test_tokens_are_hidden_in_server_logs():
    line = '"WebSocket /ws?token=abc123" [accepted]'
    assert hide_token(line) == '"WebSocket /ws?token=***" [accepted]'
    assert hide_token("/flows?limit=5&token=abc&x=1") == "/flows?limit=5&token=***&x=1"
    args = ("1.2.3.4", "/ws?token=s3cret")
    fmt = '%s - "WebSocket %s"'
    record = logging.LogRecord("uvicorn.error", logging.INFO, "", 0, fmt, args, None)
    HideTokens().filter(record)
    assert "s3cret" not in record.getMessage()
