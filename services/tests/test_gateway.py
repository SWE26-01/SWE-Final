import json
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from support import COACH, CONFIG, DASHBOARD, ENV, HOME, bearer

from gateway.main import create_app
from homeconfig import ConfigError, load_config

LIGHT = "input_boolean.living_light"
BRIGHTNESS = "input_number.living_light_brightness"
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
            return httpx.Response(200, json=[state(TV, "off"), state("person.me", "home")])
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
    app = create_app(load_config(CONFIG, ENV), ha_transport=httpx.MockTransport(ha), stream=False)
    with TestClient(app) as c:
        yield c


def call(client: TestClient, headers, service: str, **body) -> httpx.Response:
    return client.post(f"/api/services/{service}", json=body, headers=headers)


def test_owner_command_is_forwarded_with_the_ha_token(client, ha):
    r = call(client, HOME, "input_number/set_value", entity_id=BRIGHTNESS, value=80)
    assert r.status_code == 200
    assert r.json()[0]["entity_id"] == BRIGHTNESS
    (sent,) = ha.requests
    assert sent.url.path == "/api/services/input_number/set_value"
    assert json.loads(sent.content) == {"entity_id": [BRIGHTNESS], "value": 80}


def test_other_agents_cannot_move_home_devices(client, ha):
    r = call(client, COACH, "input_number/set_value", entity_id=BRIGHTNESS, value=80)
    assert r.status_code == 403
    assert "owned by home" in r.json()["message"]
    assert ha.requests == []


@pytest.mark.parametrize(
    ("service", "body", "code"),
    [
        ("input_boolean/turn_off", {"entity_id": "all"}, 403),  # HA would touch every entity
        ("input_boolean/turn_off", {"entity_id": "input_boolean.not_home"}, 403),
        ("input_boolean/turn_off", {"entity_id": LIGHT + ", input_boolean.not_home"}, 403),
        ("input_boolean/turn_off", {"entity_id": [LIGHT, "input_boolean.not_home"]}, 403),
        ("homeassistant/restart", {}, 403),
        ("input_boolean/reload", {"entity_id": LIGHT}, 403),
        ("homeassistant/turn_off", {"entity_id": LIGHT}, 403),
        ("input_select/select_option", {"entity_id": LIGHT, "option": "x"}, 403),  # not forwarded
        ("input_boolean/turn_on", {"entity_id": BRIGHTNESS}, 400),  # wrong domain for the entity
        ("input_boolean/turn_on", {"area_id": "living_room"}, 400),
        ("input_boolean/turn_on", {"entity_id": LIGHT, "area_id": "x"}, 400),
        ("input_number/set_value", {"entity_id": BRIGHTNESS}, 400),  # value missing
        ("input_boolean/turn_on", {"entity_id": []}, 400),
        ("input_boolean/turn_on", {"entity_id": 7}, 400),
    ],
)
def test_blocked_before_reaching_ha(client, ha, service, body, code):
    r = client.post(f"/api/services/{service}", json=body, headers=HOME)
    assert r.status_code == code, r.json()
    assert ha.requests == []


@pytest.mark.parametrize("content", [b"[]", b"not json", b""])
def test_body_must_be_an_object(client, ha, content):
    r = client.post("/api/services/input_boolean/turn_on", content=content, headers=HOME)
    assert r.status_code == 400
    assert ha.requests == []


@pytest.mark.parametrize(
    ("headers", "code"), [({}, 401), (bearer("nope"), 401), (bearer("t-ha"), 401), (DASHBOARD, 403)]
)
def test_only_agents_command(client, ha, headers, code):
    assert call(client, headers, "input_boolean/turn_on", entity_id=TV).status_code == code
    assert ha.requests == []


def test_read_state_of_home_devices_only(client, ha):
    r = client.get(f"/api/states/{TV}", headers=COACH)  # reading needs no ownership
    assert r.status_code == 200 and r.json()["state"] == "off"
    assert client.get(f"/api/states/{TV}", headers=DASHBOARD).status_code == 200
    hidden = client.get("/api/states/person.me", headers=HOME)
    assert hidden.status_code == 404
    assert [req.url.path for req in ha.requests] == [f"/api/states/{TV}"] * 2
    assert client.get(f"/api/states/{TV}").status_code == 401


def test_ha_errors_pass_through(client, ha):
    ha.answer = httpx.Response(400, json={"message": "Invalid value: 150"})
    r = call(client, HOME, "input_number/set_value", entity_id=BRIGHTNESS, value=150)
    assert (r.status_code, r.json()) == (400, {"message": "Invalid value: 150"})


def test_ha_down_is_502(client, ha):
    ha.fail = httpx.ConnectError("refused")
    r = call(client, HOME, "input_boolean/turn_on", entity_id=LIGHT)
    assert r.status_code == 502


def test_gateway_needs_the_ha_token():
    env = {k: v for k, v in ENV.items() if k != "HA_TOKEN"}
    with pytest.raises(ConfigError, match="HA_TOKEN"):
        create_app(load_config(CONFIG, env))


def test_devices_and_websocket_follow_home_assistant(client):
    devices = client.app.state.devices
    listed = client.get("/devices", headers=HOME).json()
    assert len(listed) == 3 and all(d["state"] is None for d in listed)

    with client.websocket_connect("/ws?token=t-dashboard") as ws:
        first = ws.receive_json()
        assert (first["type"], first["ha_connected"]) == ("snapshot", False)

        client.portal.call(devices.reload, [state(BRIGHTNESS, "50.0"), state("person.me", "home")])
        snap = ws.receive_json()
        assert snap["ha_connected"] is True
        by_entity = {d["entity"]: d for d in snap["devices"]}
        assert "person.me" not in by_entity
        assert by_entity[BRIGHTNESS]["state"] == "50.0"
        assert (by_entity[BRIGHTNESS]["owner"], by_entity[BRIGHTNESS]["space"]) == (
            "home",
            "living_room",
        )

        change = {
            "entity_id": BRIGHTNESS,
            "old_state": state(BRIGHTNESS, "50.0"),
            "new_state": state(BRIGHTNESS, "80.0"),
        }
        client.portal.call(devices.change, change, "2026-10-18T01:00:05+00:00")
        msg = ws.receive_json()
        assert msg["type"] == "device.state_changed"
        assert (msg["device"]["entity"], msg["device"]["state"], msg["previous"]) == (
            BRIGHTNESS,
            "80.0",
            "50.0",
        )

        client.portal.call(devices.disconnected)
        assert ws.receive_json()["ha_connected"] is False

    assert client.get("/health").json() == {"ok": True, "ha_connected": False}


@pytest.mark.parametrize("query", ["", "?token=t-home", "?token=nope"])
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


def test_cors_only_for_configured_origins(ha):
    env = {**ENV, "AMBIENT_CORS_ORIGINS": "http://localhost:5173"}
    app = create_app(load_config(CONFIG, env), ha_transport=httpx.MockTransport(ha), stream=False)
    with TestClient(app) as c:
        ok = preflight(c, "http://localhost:5173")
        assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert "POST" not in ok.headers["access-control-allow-methods"]  # read only
        assert "access-control-allow-origin" not in preflight(c, "http://evil.test").headers
        r = c.get("/devices", headers={**DASHBOARD, "Origin": "http://localhost:5173"})
        assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_no_cors_by_default(client):
    r = client.get("/devices", headers={**DASHBOARD, "Origin": "http://localhost:5173"})
    assert "access-control-allow-origin" not in r.headers
