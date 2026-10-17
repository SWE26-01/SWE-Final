import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from gateway.main import create_app
from homeconfig import load_config

CONTRACT = Path(__file__).resolve().parent.parent / "contracts/gateway/events.schema.json"
AT = "2026-10-17T09:00:00+09:00"


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


ROOM = auth("dev-my-room-user1")
HOME = auth("dev-home-agent")
DASH = auth("dev-dashboard")
DESKTOP = auth("dev-desktop-user1")


@pytest.fixture
def client() -> TestClient:
    # Context manager: one event loop for HTTP and WebSocket, like uvicorn.
    with TestClient(create_app(load_config())) as c:
        yield c


def cmd(client: TestClient, headers, device: str, command: str, rid: str = "r1", **params):
    body = {"request_id": rid, "command": command, "params": params}
    return client.post(f"/devices/{device}/commands", json=body, headers=headers)


def device_state(client: TestClient, device: str) -> dict:
    devices = client.get("/devices", headers=DASH).json()
    return next(d["state"] for d in devices if d["id"] == device)


def moved(person: str, space: str) -> dict:
    return {"type": "person.moved", "at": AT, "person": person, "space": space}


def assert_matches_contract(event: dict) -> None:
    """Required keys present, no unknown keys (no jsonschema dependency)."""
    variants = json.loads(CONTRACT.read_text())["oneOf"]
    schema = next(v for v in variants if v["title"] == event["type"])
    assert set(schema["required"]) <= set(event) <= set(schema["properties"])
    assert datetime.fromisoformat(event["at"]).utcoffset() == timedelta(0)


# --- auth --------------------------------------------------------------------------


def test_health_is_public(client):
    assert client.get("/health").json() == {"ok": True}


@pytest.mark.parametrize(
    "headers",
    [{}, auth("nope"), {"Authorization": "Basic x"}, auth("dev-baby-room-agent")],  # last: disabled
)
def test_missing_or_unknown_token_is_401(client, headers):
    assert client.get("/devices", headers=headers).status_code == 401
    assert cmd(client, headers, "my_room_light", "TURN_ON").status_code == 401
    assert client.get("/spaces/my_room", headers=headers).status_code == 401


def test_list_devices(client):
    devices = {d["id"]: d for d in client.get("/devices", headers=ROOM).json()}
    assert devices["my_room_ac"] == {
        "id": "my_room_ac",
        "space": "my_room",
        "kind": "ac",
        "owner": "my-room-user1",
        "state": {"power": "off", "target_temp": "24"},
    }
    assert all(d["owner"] for d in devices.values())


# --- commands ----------------------------------------------------------------------


def test_owner_command_applies(client):
    r = cmd(client, ROOM, "my_room_light", "SET_MODE", mode="meeting")
    assert r.status_code == 200
    assert r.json() == {
        "request_id": "r1",
        "device": "my_room_light",
        "state": {"power": "off", "mode": "meeting"},
        "applied": True,
    }
    assert device_state(client, "my_room_light")["mode"] == "meeting"


@pytest.mark.parametrize("headers", [HOME, DASH, DESKTOP])
def test_non_owner_is_403(client, headers):
    r = cmd(client, headers, "my_room_ac", "TURN_ON")
    assert r.status_code == 403
    assert "my-room-user1" in r.json()["detail"]
    assert device_state(client, "my_room_ac")["power"] == "off"


def test_unknown_device_is_404(client):
    assert cmd(client, ROOM, "garage_door", "TURN_ON").status_code == 404


def test_repeated_request_id_is_not_applied_again(client):
    first = cmd(client, HOME, "robot_vacuum", "START", rid="a")
    assert cmd(client, HOME, "robot_vacuum", "PAUSE", rid="b").json()["state"] == {
        "status": "paused"
    }
    again = cmd(client, HOME, "robot_vacuum", "START", rid="a")
    assert again.status_code == 200
    assert again.json() == first.json()
    assert device_state(client, "robot_vacuum") == {"status": "paused"}


def test_request_id_is_scoped_per_caller(client):
    assert cmd(client, HOME, "living_room_tv", "TURN_ON", rid="x").status_code == 200
    assert cmd(client, ROOM, "my_room_light", "TURN_ON", rid="x").status_code == 200
    assert device_state(client, "my_room_light")["power"] == "on"


def test_reused_request_id_with_other_command_is_409(client):
    assert cmd(client, ROOM, "my_room_light", "TURN_ON", rid="x").status_code == 200
    assert cmd(client, ROOM, "my_room_light", "TURN_OFF", rid="x").status_code == 409
    assert device_state(client, "my_room_light")["power"] == "on"


@pytest.mark.parametrize(
    ("device", "command", "params"),
    [
        ("my_room_light", "FLY", {}),
        ("my_room_light", "SET_TEMP", {"target_temp": "22"}),
        ("my_room_light", "SET_MODE", {}),
        ("my_room_light", "SET_MODE", {"mode": "party"}),
        ("my_room_light", "TURN_ON", {"brightness": "80"}),
        ("my_room_ac", "SET_TEMP", {"target_temp": 22}),
        ("my_room_ac", "SET_TEMP", {"target_temp": "warm"}),
        ("my_room_ac", "SET_TEMP", {"target_temp": "-3"}),
    ],
)
def test_bad_command_or_params_is_400(client, device, command, params):
    before = device_state(client, device)
    assert cmd(client, ROOM, device, command, **params).status_code == 400
    assert device_state(client, device) == before


def test_ac_and_tv_commands(client):
    assert cmd(client, ROOM, "my_room_ac", "SET_TEMP", rid="1", target_temp="22").json()[
        "state"
    ] == {"power": "off", "target_temp": "22"}
    assert cmd(client, HOME, "living_room_tv", "TURN_ON", rid="2").json()["state"] == {
        "power": "on"
    }


def test_vacuum_transitions(client):
    def go(command: str, rid: str):
        return cmd(client, HOME, "robot_vacuum", command, rid=rid)

    assert go("PAUSE", "1").status_code == 409
    assert go("RESUME", "2").status_code == 409
    assert go("START", "3").json()["state"] == {"status": "cleaning"}
    assert go("RESUME", "4").status_code == 409
    assert go("PAUSE", "5").json()["state"] == {"status": "paused"}
    assert go("RESUME", "6").json()["state"] == {"status": "cleaning"}
    assert go("DOCK", "7").json()["state"] == {"status": "idle"}


# --- spaces and inputs -------------------------------------------------------------


def test_space_read_permissions(client):
    defaults = {
        "occupied": False,
        "temperature": "26",
        "illuminance": "300",
        "sleeping": False,
        "people": [],
    }
    assert client.get("/spaces/my_room", headers=ROOM).json() == {"id": "my_room", **defaults}
    assert client.get("/spaces/my_room", headers=HOME).status_code == 200
    assert client.get("/spaces/my_room", headers=DASH).status_code == 200
    assert client.get("/spaces/living_room", headers=HOME).status_code == 200
    assert client.get("/spaces/living_room", headers=ROOM).status_code == 403
    assert client.get("/spaces/my_room", headers=DESKTOP).status_code == 403
    assert client.get("/spaces/attic", headers=DASH).status_code == 404


@pytest.mark.parametrize("headers", [ROOM, HOME])
def test_inputs_are_operator_only(client, headers):
    r = client.post("/inputs", json=moved("user1", "my_room"), headers=headers)
    assert r.status_code == 403
    assert client.get("/spaces/my_room", headers=DASH).json()["occupied"] is False


def test_person_moved_updates_occupancy(client):
    def space(space_id: str) -> dict:
        return client.get(f"/spaces/{space_id}", headers=DASH).json()

    r = client.post("/inputs", json=moved("user1", "my_room"), headers=DASH)
    assert r.status_code == 200
    assert r.json()["spaces"][0]["people"] == ["user1"]
    assert space("my_room")["occupied"] is True

    client.post("/inputs", json=moved("grandma", "my_room"), headers=DASH)
    client.post("/inputs", json=moved("user1", "living_room"), headers=DASH)
    assert space("my_room")["people"] == ["grandma"]
    assert space("my_room")["occupied"] is True
    assert space("living_room")["people"] == ["user1"]

    client.post("/inputs", json=moved("grandma", "outside"), headers=DASH)
    assert space("my_room")["occupied"] is False
    assert space("my_room")["people"] == []

    assert client.post("/inputs", json=moved("user1", "attic"), headers=DASH).status_code == 400


def test_sensor_changed(client):
    def sensor(name: str, value) -> int:
        body = {"type": "sensor.changed", "at": AT, "space": "my_room", "sensor": name}
        return client.post("/inputs", json={**body, "value": value}, headers=DASH).status_code

    assert sensor("temperature", "28") == 200
    assert sensor("occupied", True) == 200
    assert sensor("occupied", "yes") == 422
    assert sensor("temperature", 28) == 422
    assert sensor("sleeping", True) == 422  # not a sensor in the contract
    state = client.get("/spaces/my_room", headers=ROOM).json()
    assert state["temperature"] == "28" and state["occupied"] is True


# --- WebSocket -----------------------------------------------------------------------


@pytest.mark.parametrize("query", ["", "?token=nope", "?token=dev-my-room-user1"])
def test_websocket_is_operator_only(client, query):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws{query}"):
            pass
    assert exc.value.code == 1008


def test_websocket_snapshot_and_broadcast(client):
    with client.websocket_connect("/ws?token=dev-dashboard") as ws:
        snap = ws.receive_json()
        assert snap["type"] == "snapshot"
        assert {d["id"] for d in snap["devices"]} == set(load_config().devices)
        assert {s["id"] for s in snap["spaces"]} >= {"my_room", "living_room"}

        # Repeats and no-op commands are not broadcast.
        assert cmd(client, ROOM, "my_room_ac", "TURN_OFF", rid="noop").status_code == 200
        cmd(client, ROOM, "my_room_light", "TURN_ON", rid="1")
        cmd(client, ROOM, "my_room_light", "TURN_ON", rid="1")
        cmd(client, HOME, "living_room_tv", "TURN_ON", rid="1")

        evt = ws.receive_json()
        assert_matches_contract(evt)
        assert evt["type"] == "device.state_changed"
        assert (evt["device"], evt["by"]) == ("my_room_light", "my-room-user1")
        assert evt["state"] == {"power": "on", "mode": "normal"}
        assert ws.receive_json()["device"] == "living_room_tv"

        client.post("/inputs", json=moved("user1", "my_room"), headers=DASH)
        evt = ws.receive_json()
        assert_matches_contract(evt)
        assert evt["type"] == "space.state_changed"
        assert evt["space"] == "my_room"
        assert evt["state"]["occupied"] is True and evt["state"]["people"] == ["user1"]
