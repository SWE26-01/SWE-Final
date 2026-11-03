import logging
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from support import CONFIG, DASHBOARD, ENV, HOME

from collector.agents import AgentWatcher
from collector.main import create_app
from common.logs import HideTokens, hide_token
from homeconfig import load_config


class FakeAgents:
    """Agent Card endpoints of tests/config; agents in `down` refuse connections."""

    def __init__(self) -> None:
        self.down = {"coach"}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        agent = {9100: "home", 9200: "coach"}[request.url.port]
        if agent in self.down:
            raise httpx.ConnectError("refused")
        return httpx.Response(200, json={"name": agent})


async def test_watcher_reports_up_down_and_changes():
    agents = FakeAgents()
    calls = []
    config = load_config(CONFIG, ENV)
    watcher = AgentWatcher(config.agents(), lambda: calls.append(1), httpx.MockTransport(agents))
    assert await watcher.check_once() is True  # first check: home came up
    home, coach = watcher.statuses["home"], watcher.statuses["coach"]
    assert home.online is True
    assert (coach.online, coach.checked_at is not None) == (False, True)

    assert await watcher.check_once() is False  # nothing changed but the check time
    agents.down = {"home"}
    assert await watcher.check_once() is True
    assert watcher.statuses["coach"].online and not watcher.statuses["home"].online


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
        load_config(CONFIG, ENV),
        str(tmp_path / "events.sqlite"),
        agent_transport=httpx.MockTransport(FakeAgents()),
    )
    with TestClient(app) as c:
        yield c


def test_agents_endpoint_and_snapshot(client):
    agents = wait_for_first_check(client)
    assert [a["id"] for a in agents] == ["home", "coach"]
    assert {a["id"]: a["online"] for a in agents}["coach"] is False

    event = {"ts": "2026-10-18T01:00:00Z", "agent": "home", "dir": "exec", "accepted": True}
    assert client.post("/events", json=event, headers=HOME).status_code == 201
    home = next(a for a in client.get("/agents", headers=DASHBOARD).json() if a["id"] == "home")
    assert (home["events"], home["last_event_at"]) == (1, "2026-10-18T01:00:00Z")

    with client.websocket_connect("/ws?token=t-dashboard") as ws:
        snapshot = ws.receive_json()
        offline = [a["id"] for a in snapshot["agents"] if not a["online"]]
        assert (len(snapshot["agents"]), offline) == (2, ["coach"])

    assert client.get("/agents", headers=HOME).status_code == 403


def test_agents_host_for_services_in_docker():
    env = {**ENV, "AMBIENT_AGENTS_HOST": "host.docker.internal"}
    urls = {a.id: a.url for a in load_config(CONFIG, env).agents()}
    assert urls["home"] == "http://host.docker.internal:9100"
    assert {a.id: a.url for a in load_config(CONFIG, ENV).agents()}["home"] == "http://127.0.0.1:9100"


def test_tokens_are_hidden_in_server_logs():
    line = '"WebSocket /ws?token=abc123" [accepted]'
    assert hide_token(line) == '"WebSocket /ws?token=***" [accepted]'
    assert hide_token("/flows?limit=5&token=abc&x=1") == "/flows?limit=5&token=***&x=1"
    args = ("1.2.3.4", "/ws?token=s3cret")
    fmt = '%s - "WebSocket %s"'
    record = logging.LogRecord("uvicorn.error", logging.INFO, "", 0, fmt, args, None)
    HideTokens().filter(record)
    assert "s3cret" not in record.getMessage()
