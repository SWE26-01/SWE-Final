from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from support import DASHBOARD, DESKTOP, ENV, HOME, ROOM1, ROOM2, bearer

from gateway.main import create_app
from homeconfig import load_config

MODE = "input_select.room1_light_mode"
LIGHT = "input_boolean.room1_light"
TV = "input_boolean.living_tv"


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app(load_config(env=ENV))) as c:
        yield c


def call(client: TestClient, headers, service: str, **body) -> httpx.Response:
    return client.post(f"/api/services/{service}", json=body, headers=headers)


def state_of(client: TestClient, entity: str) -> str:
    return client.get(f"/api/states/{entity}", headers=DESKTOP).json()["state"]


def test_devices_start_in_their_initial_state(client):
    listed = {d["entity"]: d for d in client.get("/devices", headers=ROOM1).json()}
    assert len(listed) == 10
    assert listed[LIGHT]["state"] == "off"
    assert listed[MODE]["state"] == "normal"
    assert listed[MODE]["attributes"] == {
        "friendly_name": "내 방 조명 모드",
        "options": ["normal", "meeting", "eco"],
    }
    assert (listed[MODE]["owner"], listed[MODE]["space"]) == ("room1", "my_room")


def test_owner_command_changes_the_device(client):
    r = call(client, ROOM1, "input_select/select_option", entity_id=MODE, option="meeting")
    assert r.status_code == 200
    (new,) = r.json()  # like Home Assistant: the states that the call touched
    assert (new["entity_id"], new["state"]) == (MODE, "meeting")
    assert state_of(client, MODE) == "meeting"

    assert call(client, ROOM1, "input_boolean/turn_on", entity_id=LIGHT).status_code == 200
    assert state_of(client, LIGHT) == "on"
    assert call(client, ROOM1, "input_boolean/toggle", entity_id=[LIGHT]).status_code == 200
    assert state_of(client, LIGHT) == "off"


def test_home_cannot_move_a_room_device(client):
    r = call(client, HOME, "input_select/select_option", entity_id=MODE, option="meeting")
    assert r.status_code == 403
    assert "owned by room1" in r.json()["message"]
    assert state_of(client, MODE) == "normal"


@pytest.mark.parametrize(
    ("service", "body", "code"),
    [
        ("input_boolean/turn_off", {"entity_id": TV}, 403),  # orchestrator's TV
        ("input_boolean/turn_off", {"entity_id": f"{LIGHT}, {TV}"}, 403),
        ("input_boolean/turn_off", {"entity_id": [LIGHT, TV]}, 403),
        ("input_boolean/turn_off", {"entity_id": "all"}, 403),
        ("input_boolean/turn_off", {"entity_id": "input_boolean.not_home"}, 403),
        ("homeassistant/restart", {}, 403),
        ("input_boolean/reload", {"entity_id": LIGHT}, 403),
        ("homeassistant/turn_off", {"entity_id": LIGHT}, 403),
        ("input_boolean/turn_on", {"entity_id": MODE}, 400),  # wrong domain for the entity
        ("input_boolean/turn_on", {"area_id": "my_room"}, 400),
        ("input_boolean/turn_on", {"entity_id": LIGHT, "area_id": "x"}, 400),
        ("input_select/select_option", {"entity_id": MODE}, 400),  # option missing
        ("input_select/select_option", {"entity_id": MODE, "option": "party"}, 400),
        ("input_boolean/turn_on", {"entity_id": []}, 400),
        ("input_boolean/turn_on", {"entity_id": 7}, 400),
    ],
)
def test_blocked_without_changing_anything(client, service, body, code):
    before = client.get("/devices", headers=ROOM1).json()
    r = client.post(f"/api/services/{service}", json=body, headers=ROOM1)
    assert r.status_code == code, r.json()
    assert "message" in r.json()
    assert client.get("/devices", headers=ROOM1).json() == before


@pytest.mark.parametrize("content", [b"[]", b"not json", b""])
def test_body_must_be_an_object(client, content):
    r = client.post("/api/services/input_boolean/turn_on", content=content, headers=ROOM1)
    assert r.status_code == 400


@pytest.mark.parametrize(("headers", "code"), [({}, 401), (bearer("nope"), 401), (DASHBOARD, 403)])
def test_only_agents_command(client, headers, code):
    assert call(client, headers, "input_boolean/turn_on", entity_id=TV).status_code == code
    assert state_of(client, TV) == "off"


def test_anyone_known_reads_home_devices_only(client):
    r = client.get(f"/api/states/{TV}", headers=ROOM2)  # reading needs no ownership
    assert r.status_code == 200 and r.json()["state"] == "off"
    assert client.get(f"/api/states/{TV}", headers=DASHBOARD).status_code == 200
    assert client.get("/api/states/person.me", headers=ROOM1).status_code == 404
    assert client.get(f"/api/states/{TV}").status_code == 401


def test_websocket_follows_the_devices(client):
    with client.websocket_connect("/ws?token=t-dashboard") as ws:
        first = ws.receive_json()
        assert first["type"] == "snapshot"
        by_entity = {d["entity"]: d for d in first["devices"]}
        assert by_entity[MODE]["state"] == "normal"

        call(client, ROOM1, "input_select/select_option", entity_id=MODE, option="meeting")
        msg = ws.receive_json()
        assert msg["type"] == "device.state_changed"
        assert (msg["device"]["entity"], msg["device"]["state"], msg["previous"]) == (
            MODE,
            "meeting",
            "normal",
        )
        # Commands that change nothing are not announced: the next message is the light.
        call(client, ROOM1, "input_select/select_option", entity_id=MODE, option="meeting")
        call(client, ROOM1, "input_boolean/turn_on", entity_id=LIGHT)
        assert ws.receive_json()["device"]["entity"] == LIGHT

    assert client.get("/health").json() == {"ok": True, "devices": 10}


@pytest.mark.parametrize("query", ["", "?token=t-room1", "?token=nope"])
def test_websocket_is_operator_only(client, query):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws{query}") as ws:
            ws.receive_json()
    assert exc.value.code == 1008


def preflight(client: TestClient, origin: str) -> httpx.Response:
    headers = {
        "Origin": origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
    }
    return client.options("/devices", headers=headers)


def test_cors_only_for_configured_origins():
    env = {**ENV, "AMBIENT_CORS_ORIGINS": "http://localhost:3000"}
    with TestClient(create_app(load_config(env=env))) as c:
        ok = preflight(c, "http://localhost:3000")
        assert ok.headers["access-control-allow-origin"] == "http://localhost:3000"
        assert "POST" not in ok.headers["access-control-allow-methods"]  # read only
        assert "access-control-allow-origin" not in preflight(c, "http://evil.test").headers
        r = c.get("/devices", headers={**DASHBOARD, "Origin": "http://localhost:3000"})
        assert r.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_no_cors_by_default(client):
    r = client.get("/devices", headers={**DASHBOARD, "Origin": "http://localhost:3000"})
    assert "access-control-allow-origin" not in r.headers
