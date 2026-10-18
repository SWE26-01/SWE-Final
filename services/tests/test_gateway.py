import json
from collections.abc import Iterator
from datetime import UTC, datetime

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from support import DASHBOARD, DESKTOP, ENV, HOME, ROOM1, bearer

from gateway.main import create_app
from homeconfig import ConfigError, load_config

MODE = "input_select.room1_light_mode"
TV = "input_boolean.living_tv"


class FakeHA:
    """Home Assistant REST API stand-in that records what reached it."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.fail: Exception | None = None
        self.answer: httpx.Response | None = None

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer t-ha"  # never an agent token
        if self.fail is not None:
            raise self.fail
        self.requests.append(request)
        if self.answer is not None:
            return self.answer
        path = request.url.path
        if request.method == "GET" and path == "/api/states":
            return httpx.Response(200, json=[state(MODE, "normal"), state("person.me", "home")])
        if request.method == "GET" and path.startswith("/api/logbook/"):
            return httpx.Response(200, json=[])
        if request.method == "GET":
            return httpx.Response(200, json=state(path.rsplit("/", 1)[1], "off"))
        body = json.loads(request.content)
        return httpx.Response(200, json=[state(e, "on") for e in body["entity_id"]])


def state(entity: str, value: str) -> dict:
    return {
        "entity_id": entity,
        "state": value,
        "attributes": {"friendly_name": entity},
        "last_changed": "2026-10-18T01:00:00+00:00",
    }


@pytest.fixture
def ha() -> FakeHA:
    return FakeHA()


@pytest.fixture
def client(ha: FakeHA) -> Iterator[TestClient]:
    app = create_app(load_config(env=ENV), ha_transport=httpx.MockTransport(ha), stream=False)
    with TestClient(app) as c:
        yield c


def call(client: TestClient, headers, service: str, **body) -> httpx.Response:
    return client.post(f"/api/services/{service}", json=body, headers=headers)


def test_owner_command_is_forwarded_with_the_ha_token(client, ha):
    r = call(client, ROOM1, "input_select/select_option", entity_id=MODE, option="meeting")
    assert r.status_code == 200
    assert r.json()[0]["entity_id"] == MODE
    (sent,) = ha.requests
    assert sent.url.path == "/api/services/input_select/select_option"
    assert json.loads(sent.content) == {"entity_id": [MODE], "option": "meeting"}


def test_home_cannot_move_a_room_device(client, ha):
    r = call(client, HOME, "input_select/select_option", entity_id=MODE, option="meeting")
    assert r.status_code == 403
    assert "owned by room1" in r.json()["message"]
    assert ha.requests == []


@pytest.mark.parametrize(
    ("service", "body", "code"),
    [
        ("input_boolean/turn_off", {"entity_id": TV}, 403),  # orchestrator's TV
        ("input_boolean/turn_off", {"entity_id": "input_boolean.room1_light, " + TV}, 403),
        ("input_boolean/turn_off", {"entity_id": ["input_boolean.room1_light", TV]}, 403),
        ("input_boolean/turn_off", {"entity_id": "all"}, 403),  # HA would touch every entity
        ("input_boolean/turn_off", {"entity_id": "input_boolean.not_home"}, 403),
        ("homeassistant/restart", {}, 403),
        ("input_boolean/reload", {"entity_id": "input_boolean.room1_light"}, 403),
        ("homeassistant/turn_off", {"entity_id": "input_boolean.room1_light"}, 403),
        ("input_boolean/turn_on", {"entity_id": MODE}, 400),  # wrong domain for the entity
        ("input_boolean/turn_on", {"area_id": "my_room"}, 400),
        ("input_boolean/turn_on", {"entity_id": "input_boolean.room1_light", "area_id": "x"}, 400),
        ("input_select/select_option", {"entity_id": MODE}, 400),  # option missing
        ("input_boolean/turn_on", {"entity_id": []}, 400),
        ("input_boolean/turn_on", {"entity_id": 7}, 400),
    ],
)
def test_blocked_before_reaching_ha(client, ha, service, body, code):
    r = client.post(f"/api/services/{service}", json=body, headers=ROOM1)
    assert r.status_code == code, r.json()
    assert ha.requests == []


@pytest.mark.parametrize("content", [b"[]", b"not json", b""])
def test_body_must_be_an_object(client, ha, content):
    r = client.post("/api/services/input_boolean/turn_on", content=content, headers=ROOM1)
    assert r.status_code == 400
    assert ha.requests == []


@pytest.mark.parametrize(
    ("headers", "code"), [({}, 401), (bearer("nope"), 401), (bearer("t-ha"), 401), (DASHBOARD, 403)]
)
def test_only_agents_command(client, ha, headers, code):
    assert call(client, headers, "input_boolean/turn_on", entity_id=TV).status_code == code
    assert ha.requests == []


def test_read_state_of_home_devices_only(client, ha):
    r = client.get(f"/api/states/{TV}", headers=DESKTOP)  # reading needs no ownership
    assert r.status_code == 200 and r.json()["state"] == "off"
    assert client.get(f"/api/states/{TV}", headers=DASHBOARD).status_code == 200
    hidden = client.get("/api/states/person.me", headers=ROOM1)
    assert hidden.status_code == 404
    assert [req.url.path for req in ha.requests] == [f"/api/states/{TV}"] * 2
    assert client.get(f"/api/states/{TV}").status_code == 401


def test_ha_errors_pass_through(client, ha):
    ha.answer = httpx.Response(400, json={"message": "Invalid option: party"})
    r = call(client, ROOM1, "input_select/select_option", entity_id=MODE, option="party")
    assert (r.status_code, r.json()) == (400, {"message": "Invalid option: party"})


def test_ha_down_is_502(client, ha):
    ha.fail = httpx.ConnectError("refused")
    r = call(client, ROOM1, "input_boolean/turn_on", entity_id="input_boolean.room1_light")
    assert r.status_code == 502


def test_gateway_needs_the_ha_token():
    env = {k: v for k, v in ENV.items() if k != "HA_TOKEN"}
    with pytest.raises(ConfigError, match="HA_TOKEN"):
        create_app(load_config(env=env))


def test_devices_and_websocket_follow_home_assistant(client):
    devices = client.app.state.devices
    listed = client.get("/devices", headers=ROOM1).json()
    assert len(listed) == 31 and all(d["state"] is None for d in listed)

    with client.websocket_connect("/ws?token=t-dashboard") as ws:
        first = ws.receive_json()
        assert (first["type"], first["ha_connected"]) == ("snapshot", False)

        client.portal.call(devices.reload, [state(MODE, "normal"), state("person.me", "home")])
        snap = ws.receive_json()
        assert snap["ha_connected"] is True
        by_entity = {d["entity"]: d for d in snap["devices"]}
        assert "person.me" not in by_entity
        assert by_entity[MODE]["state"] == "normal"
        assert by_entity[MODE]["owner"] == "room1" and by_entity[MODE]["space"] == "bedroom1"

        change = {
            "entity_id": MODE,
            "old_state": state(MODE, "normal"),
            "new_state": state(MODE, "meeting"),
        }
        client.portal.call(devices.change, change, "2026-10-18T01:00:05+00:00")
        msg = ws.receive_json()
        assert msg["type"] == "device.state_changed"
        assert (msg["device"]["entity"], msg["device"]["state"], msg["previous"]) == (
            MODE,
            "meeting",
            "normal",
        )

        client.portal.call(devices.disconnected)
        assert ws.receive_json()["ha_connected"] is False

    assert client.get("/health").json() == {"ok": True, "ha_connected": False}


def test_area_devices_are_added_and_deleted_from_snapshots(client):
    devices = client.app.state.devices
    extra = "switch.reading_lamp"
    with client.websocket_connect("/ws?token=t-dashboard") as ws:
        ws.receive_json()
        client.portal.call(
            devices.reload,
            [state(TV, "off"), state(extra, "on")],
            {extra: "침실 1"},
        )
        snapshot = ws.receive_json()
        by_entity = {item["entity"]: item for item in snapshot["devices"]}
        assert by_entity[extra]["space"] == "bedroom1"
        assert by_entity[extra]["owner"] == "room1"

        client.portal.call(
            devices.change,
            {"entity_id": extra, "old_state": state(extra, "on"), "new_state": None},
            "2026-10-18T01:00:06+00:00",
        )
        assert extra not in {item["entity"] for item in ws.receive_json()["devices"]}


def test_dashboard_can_control_visible_devices_only(client, ha):
    devices = client.app.state.devices
    device = "input_boolean.kitchen_stove"
    client.portal.call(devices.reload, [state(device, "off"), state(TV, "off")])

    response = client.post(f"/dashboard/devices/{device}/turn_on", headers=DASHBOARD)
    assert response.status_code == 200
    assert ha.requests[-1].url.path == "/api/services/input_boolean/turn_on"
    assert json.loads(ha.requests[-1].content) == {"entity_id": device}

    unknown = client.post("/dashboard/devices/sensor.unknown/turn_on", headers=DASHBOARD)
    assert unknown.status_code == 403
    assert client.post(f"/dashboard/devices/{device}/toggle", headers=DASHBOARD).status_code == 400
    assert client.post(f"/dashboard/devices/{device}/turn_on", headers=ROOM1).status_code == 403


def test_dashboard_activity_keeps_ha_shape_and_labels_agent_and_user(client, ha):
    devices = client.app.state.devices
    device = "input_boolean.kitchen_stove"
    client.portal.call(devices.reload, [state(device, "off")])
    assert call(client, HOME, "input_boolean/turn_on", entity_id=device).status_code == 200
    now = datetime.now(UTC).isoformat()
    ha.answer = httpx.Response(200, json=[
        {
            "state": "on", "entity_id": device, "name": "화구", "icon": "mdi:stove",
            "when": now, "context_domain": "input_boolean", "context_service": "turn_on",
            "context_event_type": "call_service",
        },
        {
            "state": "off", "entity_id": device, "name": "화구", "icon": "mdi:stove",
            "when": now, "context_domain": "input_boolean", "context_service": "turn_off",
            "context_event_type": "call_service",
        },
        {
            "state": "home", "entity_id": "person.me", "name": "Me", "when": now,
        },
    ])

    response = client.get("/dashboard/activity", headers=DASHBOARD)
    assert response.status_code == 200
    agent, user = response.json()
    assert agent["action_type"] == "agent" and agent["actor"] == "Home Agent"
    assert user["action_type"] == "user" and user["actor"] == "사용자"
    assert agent["context_event_type"] == "call_service"
    assert "person.me" not in {item["entity_id"] for item in response.json()}
    logbook_request = ha.requests[-1]
    assert logbook_request.url.path == "/api/logbook/2026-10-17T15:00:00+00:00"
    assert logbook_request.url.params["end_time"] == "2026-10-18T15:00:00+00:00"


def test_dashboard_activity_accepts_a_korean_calendar_day(client, ha):
    response = client.get("/dashboard/activity?day=2026-10-17", headers=DASHBOARD)
    assert response.status_code == 200
    request = ha.requests[-1]
    assert request.url.path == "/api/logbook/2026-10-16T15:00:00+00:00"
    assert request.url.params["end_time"] == "2026-10-17T15:00:00+00:00"


@pytest.mark.parametrize("query", ["", "?token=t-room1", "?token=nope"])
def test_websocket_is_operator_only(client, query):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws{query}") as ws:
            ws.receive_json()
    assert exc.value.code == 1008
