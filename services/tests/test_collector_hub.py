"""The Event Collector with the Agent Hub (COLLECTOR_HUB_URL): agents connected in the Hub post
events with their Hub-issued token and are watched while they stay connected."""

import json
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from support import DASHBOARD, ENV, bearer

from collector.agents import AgentWatcher
from collector.main import create_app
from common.hublink import HubLink
from homeconfig import load_config

MEETING_URL = "http://127.0.0.1:19400/plugins/a2a"


class FakeHub:
    def __init__(self) -> None:
        self.peers = {"room1": "http://127.0.0.1:19160/plugins/a2a", "meeting": MEETING_URL}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/runtime/peers":
            return httpx.Response(200, json=self.peers)
        if request.url.path == "/tokens/verify":
            active = json.loads(request.content)["token"] == "hub-meeting"
            return httpx.Response(200, json={"active": active, "agent_id": "meeting"})
        return httpx.Response(404)


def link(hub: FakeHub) -> HubLink:
    return HubLink("http://hub", "t-runtime", ttl=0, transport=httpx.MockTransport(hub))


def event(agent: str) -> dict:
    return {"ts": "2026-11-21T01:00:00Z", "agent": agent, "dir": "exec", "accepted": True}


def test_a_hub_connected_agent_posts_its_own_events(tmp_path: Path):
    app = create_app(
        load_config(env=ENV),
        str(tmp_path / "e.sqlite"),
        watch_agents=False,
        hub_link_=link(FakeHub()),
    )
    with TestClient(app) as c:
        assert (
            c.post("/events", json=event("meeting"), headers=bearer("hub-meeting")).status_code
            == 201
        )
        spoof = c.post("/events", json=event("room1"), headers=bearer("hub-meeting"))
        assert spoof.status_code == 403
        assert (
            c.post("/events", json=event("meeting"), headers=bearer("revoked")).status_code == 401
        )
        assert [e["agent"] for e in c.get("/events", headers=DASHBOARD).json()] == ["meeting"]


async def test_the_watcher_follows_hub_connections():
    hub = FakeHub()
    seen = []

    def agents(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        tags = ["room", "space:my_room", "device:input_select.room1_light_mode"]
        return httpx.Response(200, json={"skills": [{"id": "device.control", "tags": tags}]})

    config = load_config(env=ENV)
    watcher = AgentWatcher(
        config.agents(),
        lambda: None,
        httpx.MockTransport(agents),
        hub=link(hub),
        agents_host="agents",
    )
    assert await watcher.check_once() is True
    meeting = watcher.statuses["meeting"]
    assert meeting.online and meeting.owned_devices == ["input_select.room1_light_mode"]
    assert "http://agents:19400/plugins/a2a/.well-known/agent-card.json" in seen

    del hub.peers["meeting"]  # disconnected in the Hub
    assert await watcher.check_once() is True
    assert "meeting" not in watcher.statuses and "room1" in watcher.statuses
