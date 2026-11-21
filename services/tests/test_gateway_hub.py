"""The Gateway with the Agent Hub in charge (GATEWAY_HUB_URL): Hub-issued tokens and the Hub's
current device owners decide, and a Hub that cannot be reached means no commands."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient
from support import DASHBOARD, ENV, ROOM1, bearer

from common.hublink import HubLink
from gateway.main import create_app
from homeconfig import load_config

MODE = "input_select.room1_light_mode"
LIGHT = "input_boolean.room1_light"
MEETING = bearer("hub-issued-meeting")


class FakeHub:
    """Hub answers: room1 handed its light mode to a Studio agent connected with a Hub token."""

    def __init__(self) -> None:
        self.owners = {LIGHT: "room1", MODE: "meeting-agent"}
        self.tokens = {"hub-issued-meeting": "meeting-agent"}
        self.down = False
        self.calls: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request.url.path)
        if self.down:
            raise httpx.ConnectError("refused")
        assert request.headers["authorization"] == "Bearer t-runtime"
        if request.url.path == "/ownership":
            return httpx.Response(200, json=self.owners)
        if request.url.path == "/tokens/verify":
            agent = self.tokens.get(json.loads(request.content)["token"])
            return httpx.Response(200, json={"active": agent is not None, "agent_id": agent})
        return httpx.Response(404)


@pytest.fixture
def hub() -> FakeHub:
    return FakeHub()


@pytest.fixture
def client(hub):
    link = HubLink("http://hub", "t-runtime", ttl=0, transport=httpx.MockTransport(hub))
    with TestClient(create_app(load_config(env=ENV), link)) as c:
        yield c


def select(client: TestClient, headers, option: str) -> httpx.Response:
    body = {"entity_id": MODE, "option": option}
    return client.post("/api/services/input_select/select_option", json=body, headers=headers)


def test_the_connected_owner_commands_with_its_hub_token(client):
    r = select(client, MEETING, "meeting")
    assert r.status_code == 200 and r.json()[0]["state"] == "meeting"
    assert client.get(f"/api/states/{MODE}", headers=MEETING).json()["state"] == "meeting"


def test_the_config_owner_lost_the_device_it_handed_over(client):
    r = select(client, ROOM1, "eco")
    assert r.status_code == 403 and "owned by meeting-agent" in r.json()["message"]
    on = client.post(
        "/api/services/input_boolean/turn_on", json={"entity_id": LIGHT}, headers=ROOM1
    )
    assert on.status_code == 200  # what it still owns


def test_a_device_without_a_connected_owner_moves_for_nobody(client, hub):
    hub.owners[MODE] = None
    assert select(client, ROOM1, "eco").status_code == 403
    assert "no connected owner" in select(client, MEETING, "eco").json()["message"]


def test_revoked_and_unknown_tokens_are_refused(client, hub):
    hub.tokens.clear()
    assert select(client, MEETING, "meeting").status_code == 401
    assert client.get(f"/api/states/{MODE}", headers=MEETING).status_code == 401
    assert select(client, DASHBOARD, "meeting").status_code == 403  # operators read only


def test_no_hub_no_commands(client, hub):
    hub.down = True
    r = select(client, ROOM1, "eco")  # even a config agent: owners come from the Hub
    assert r.status_code == 503 and "refused" in r.json()["message"]
    assert select(client, MEETING, "eco").status_code == 503
    assert client.get(f"/api/states/{MODE}", headers=ROOM1).status_code == 200  # reads go on
    assert client.get("/devices", headers=DASHBOARD).status_code == 200


def test_answers_are_cached_for_the_ttl(hub):
    link = HubLink("http://hub", "t-runtime", ttl=60, transport=httpx.MockTransport(hub))
    with TestClient(create_app(load_config(env=ENV), link)) as c:
        for _ in range(3):
            assert select(c, MEETING, "meeting").status_code == 200
    assert hub.calls.count("/ownership") == 1 and hub.calls.count("/tokens/verify") == 1
