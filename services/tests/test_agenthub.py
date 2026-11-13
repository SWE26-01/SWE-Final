from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from support import DASHBOARD, ENV, ROOM1, STUDIO, USER

from agenthub.main import create_app
from homeconfig import load_config

LIGHT_MODE = "input_select.room1_light_mode"


def meeting_agent(**kw) -> dict:
    """What Studio registers for "내 방 회의 모드" (studio/main.py `approve_draft`)."""
    owned = ["input_boolean.room1_light", LIGHT_MODE]
    return {
        "id": "my-room-meeting-mode-ab12",
        "name": "내 방 회의 도우미",
        "description": "회의 중에는 내 방을 조용하게 맞춰요",
        "role": "room",
        "space": "my_room",
        "url": "http://127.0.0.1:19400/plugins/ambient",
        "skills": ["meeting_mode"],
        "owned_devices": owned,
        "permissions": [f"device:{e}" for e in owned] + ["context:desktop.meeting_app_active"],
        "spec_id": "d1",
        **kw,
    }


def card(name: str = "weather", version: str = "1.0", **params) -> dict:
    """An Agent Card shaped like ../agents/ambient-a2a-plugin/src/a2a.ts `agentCard`."""
    base = "http://ext.test/plugins/ambient"
    return {
        "name": name,
        "description": "External weather agent",
        "supportedInterfaces": [
            {"url": f"{base}/a2a/v1", "protocolBinding": "JSONRPC", "protocolVersion": version}
        ],
        "capabilities": {
            "extensions": [
                {
                    "uri": "https://github.com/nsu102/A2A-agents/spec/ambient-a2a/v1",
                    "params": {"role": "external", "provided_fields": ["rain_expected"], **params},
                }
            ]
        },
        "skills": [{"id": "context.query", "name": "Context query"}],
    }


def serve(cards: dict[str, dict]) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        found = cards.get(str(request.url))
        return httpx.Response(200, json=found) if found else httpx.Response(404)

    return httpx.MockTransport(handle)


@pytest.fixture
def hub() -> Iterator[TestClient]:
    with TestClient(create_app(load_config(env=ENV), "sqlite://", sync_cards=False)) as c:
        yield c


def connection_of(hub: TestClient, agent_id: str) -> str:
    found = hub.get(f"/connections?agent_id={agent_id}&active=true", headers=USER).json()
    assert len(found) == 1
    return found[0]["id"]


def free_room1(hub: TestClient) -> None:
    r = hub.delete(f"/connections/{connection_of(hub, 'room1')}", headers=USER)
    assert r.status_code == 200 and r.json()["active"] is False


def test_platform_agents_are_seeded_connected_with_their_devices(hub):
    agents = {a["id"]: a for a in hub.get("/agents", headers=USER).json()}
    assert set(agents) == {"desktop", "smartphone", "orchestrator", "room1", "room2"}
    room1 = agents["room1"]
    assert room1["origin"] == "platform" and room1["connected"] and room1["space"] == "my_room"
    assert LIGHT_MODE in room1["owned_devices"]
    assert hub.get("/ownership", headers=DASHBOARD).json()[LIGHT_MODE] == "room1"
    spaces = {s["id"]: s for s in hub.get("/spaces", headers=USER).json()}
    kinds = {d["kind"] for d in spaces["protected_room"]["devices"]}
    assert kinds == {"light", "ac", "sleep_mode"}


def test_every_route_needs_a_known_token(hub):
    assert hub.get("/agents").status_code == 401
    assert hub.get("/agents", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert hub.get("/skills", headers=DASHBOARD).status_code == 200


def test_marketplace_lists_the_skills(hub):
    skills = {s["id"]: s for s in hub.get("/skills", headers=USER).json()}
    assert {"meeting_mode", "sleep_mode", "energy_saving", "location_aware"} <= set(skills)
    assert skills["meeting_mode"]["subscribes"] == {"desktop": ["meeting_app_active"]}
    assert hub.get("/skills/nope", headers=USER).status_code == 404


def test_only_studio_registers_agents(hub):
    assert hub.post("/agents", json=meeting_agent(), headers=USER).status_code == 403
    r = hub.post("/agents", json=meeting_agent(), headers=STUDIO)
    assert r.status_code == 201 and r.json()["origin"] == "studio" and not r.json()["connected"]
    again = hub.post("/agents", json=meeting_agent(), headers=STUDIO)
    assert again.status_code == 409 and again.json()["detail"]["reason_code"] == "AGENT_EXISTS"


@pytest.mark.parametrize(
    "change, problem",
    [
        ({"skills": ["nope"]}, "unknown skill"),
        ({"space": "garage"}, "unknown space"),
        ({"owned_devices": ["input_boolean.room2_ac"]}, "is in protected_room"),
        ({"permissions": []}, "does not ask for device:"),
    ],
)
def test_registrations_are_checked_against_the_home(hub, change, problem):
    r = hub.post("/agents", json=meeting_agent(**change), headers=STUDIO)
    assert r.status_code == 422 and problem in r.json()["detail"]["message"]


def test_search_by_skill_space_and_text(hub):
    hub.post("/agents", json=meeting_agent(), headers=STUDIO)

    def ids(query: str) -> set[str]:
        return {a["id"] for a in hub.get(f"/agents?{query}", headers=USER).json()}

    assert ids("skill=meeting_mode") == {"my-room-meeting-mode-ab12"}
    assert ids("space=my_room") == {"room1", "my-room-meeting-mode-ab12"}
    assert ids("q=회의") == {"my-room-meeting-mode-ab12"}
    assert ids("origin=studio&connected=false") == {"my-room-meeting-mode-ab12"}


def test_each_device_keeps_one_owner(hub):
    hub.post("/agents", json=meeting_agent(), headers=STUDIO)
    body = {"agent_id": "my-room-meeting-mode-ab12"}
    taken = hub.post("/connections", json=body, headers=USER)
    assert taken.status_code == 409
    detail = taken.json()["detail"]
    assert detail["reason_code"] == "OWNERSHIP_CONFLICT" and detail["owners"][LIGHT_MODE] == "room1"

    free_room1(hub)
    r = hub.post("/connections", json=body, headers=USER)
    assert r.status_code == 201
    conn = r.json()
    assert conn["token"] and not conn["platform"]
    assert conn["token_env"] == "AMBIENT_TOKEN_MY_ROOM_MEETING_MODE_AB12"
    assert hub.get("/ownership", headers=USER).json()[LIGHT_MODE] == "my-room-meeting-mode-ab12"
    assert hub.post("/connections", json=body, headers=USER).status_code == 409  # already
    back = hub.post("/connections", json={"agent_id": "room1"}, headers=USER)
    assert back.json()["detail"]["owners"][LIGHT_MODE] == "my-room-meeting-mode-ab12"


def test_only_the_user_connects_and_disconnects(hub):
    room1 = connection_of(hub, "room1")
    assert hub.delete(f"/connections/{room1}", headers=DASHBOARD).status_code == 403
    assert hub.delete(f"/connections/{room1}", headers=STUDIO).status_code == 403
    assert hub.post("/connections", json={"agent_id": "room1"}, headers=ROOM1).status_code == 403


def test_a_token_works_only_while_connected(hub):
    hub.post("/agents", json=meeting_agent(), headers=STUDIO)
    free_room1(hub)
    conn = hub.post("/connections", json={"agent_id": "my-room-meeting-mode-ab12"}, headers=USER)
    token = conn.json()["token"]
    ok = hub.post("/tokens/verify", json={"token": token}, headers=ROOM1).json()
    assert ok["active"] and ok["agent_id"] == "my-room-meeting-mode-ab12"
    assert "context:desktop.meeting_app_active" in ok["permissions"]
    assert hub.post("/tokens/verify", json={"token": token}, headers=USER).status_code == 403
    listed = hub.get("/connections?agent_id=my-room-meeting-mode-ab12", headers=USER).text
    assert token not in listed and token not in hub.get("/audit", headers=USER).text

    hub.delete(f"/connections/{conn.json()['id']}", headers=USER)
    gone = hub.post("/tokens/verify", json={"token": token}, headers=STUDIO).json()
    assert gone == {"active": False, "agent_id": None, "connection_id": None, "permissions": []}
    assert hub.get("/ownership", headers=USER).json()[LIGHT_MODE] is None


def test_the_user_approves_a_subset_of_what_the_agent_asks(hub):
    hub.post("/agents", json=meeting_agent(), headers=STUDIO)
    free_room1(hub)
    extra = {
        "agent_id": "my-room-meeting-mode-ab12",
        "permissions": ["device:input_boolean.room2_ac"],
    }
    r = hub.post("/connections", json=extra, headers=USER)
    assert r.status_code == 422 and r.json()["detail"]["reason_code"] == "NOT_REQUESTED"
    subset = {"agent_id": "my-room-meeting-mode-ab12", "permissions": [f"device:{LIGHT_MODE}"]}
    r = hub.post("/connections", json=subset, headers=USER)
    assert r.status_code == 201 and r.json()["permissions"] == [f"device:{LIGHT_MODE}"]
    assert hub.get("/ownership", headers=USER).json()["input_boolean.room1_light"] is None


def test_platform_agents_reconnect_with_their_env_token(hub):
    free_room1(hub)
    r = hub.post("/connections", json={"agent_id": "room1"}, headers=USER)
    assert r.status_code == 201
    assert r.json()["token"] is None and r.json()["platform"]
    assert r.json()["token_env"] == "AMBIENT_TOKEN_ROOM1"
    assert hub.delete("/agents/room1", headers=USER).status_code == 400


def test_removing_an_agent_revokes_it(hub):
    hub.post("/agents", json=meeting_agent(), headers=STUDIO)
    free_room1(hub)
    hub.post("/connections", json={"agent_id": "my-room-meeting-mode-ab12"}, headers=USER)
    r = hub.delete("/agents/my-room-meeting-mode-ab12", headers=USER)
    assert r.status_code == 200 and r.json()["removed"]
    assert hub.get("/ownership", headers=USER).json()[LIGHT_MODE] is None
    assert "my-room-meeting-mode-ab12" not in {
        a["id"] for a in hub.get("/agents", headers=USER).json()
    }
    assert hub.post("/agents", json=meeting_agent(), headers=STUDIO).status_code == 201  # again


def test_runtime_views_for_the_agents(hub):
    hub.post("/agents", json=meeting_agent(), headers=STUDIO)
    free_room1(hub)
    hub.post("/connections", json={"agent_id": "my-room-meeting-mode-ab12"}, headers=USER)
    peers = hub.get("/runtime/peers", headers=ROOM1).json()
    assert peers["my-room-meeting-mode-ab12"] == "http://127.0.0.1:19400/plugins/ambient"
    assert "room1" not in peers
    acl = hub.get("/runtime/acl/desktop", headers=ROOM1).json()
    assert acl == {"my-room-meeting-mode-ab12": ["meeting_app_active"]}


def test_external_agents_sign_up_with_their_card():
    url = "http://ext.test/plugins/ambient/.well-known/agent-card.json"
    transport = serve(
        {url: card(), "http://old.test/.well-known/agent-card.json": card("old", "0.3")}
    )
    app = create_app(load_config(env=ENV), "sqlite://", sync_cards=False, card_transport=transport)
    with TestClient(app) as hub:
        r = hub.post(
            "/agents/discover", json={"card_url": "http://ext.test/plugins/ambient"}, headers=USER
        )
        assert r.status_code == 201
        agent = r.json()
        assert agent["id"] == "weather" and agent["origin"] == "external" and not agent["connected"]
        assert agent["url"] == "http://ext.test/plugins/ambient"
        assert agent["provided_fields"] == ["rain_expected"] and agent["permissions"] == []
        old = hub.post("/agents/discover", json={"card_url": "http://old.test"}, headers=USER)
        assert old.status_code == 422 and "1.0" in old.json()["detail"]["message"]
        missing = hub.post("/agents/discover", json={"card_url": "http://none.test"}, headers=USER)
        assert missing.status_code == 422
        bad = hub.post("/agents/discover", json={"card_url": "file:///etc/passwd"}, headers=USER)
        assert bad.status_code == 422


def test_platform_details_come_from_their_running_cards():
    desktop = card("desktop", provided_fields=["meeting_app_active", "pc_state"])
    transport = serve(
        {"http://127.0.0.1:18800/plugins/ambient/.well-known/agent-card.json": desktop}
    )
    app = create_app(load_config(env=ENV), "sqlite://", sync_cards=False, card_transport=transport)
    with TestClient(app) as hub:
        r = hub.post("/agents/desktop/refresh", headers=USER)
        assert r.status_code == 200
        assert r.json()["role"] == "external" and "pc_state" in r.json()["provided_fields"]
        assert hub.post("/agents/room1/refresh", headers=USER).status_code == 502  # not running


def test_a_restart_keeps_what_the_user_decided(tmp_path: Path):
    db = f"sqlite:///{tmp_path / 'hub.sqlite'}"
    with TestClient(create_app(load_config(env=ENV), db, sync_cards=False)) as hub:
        free_room1(hub)
    with TestClient(create_app(load_config(env=ENV), db, sync_cards=False)) as hub:
        room1 = hub.get("/agents/room1", headers=USER).json()
        assert not room1["connected"]
        actions = [a["action"] for a in hub.get("/audit", headers=USER).json()]
        assert actions[0] == "disconnect" and actions.count("register") == 5


def test_marketplace_search_says_which_rooms_can_run_a_skill(hub):
    def ids(query: str) -> list[str]:
        return [s["id"] for s in hub.get(f"/skills?{query}", headers=USER).json()]

    assert ids("q=회의") == ["meeting_mode"]
    assert ids("category=safety") == ["sleep_mode"]
    assert ids("space=my_room") == ["meeting_mode", "energy_saving", "location_aware"]
    sleep = hub.get("/skills/sleep_mode", headers=USER).json()
    assert sleep["available_spaces"] == ["protected_room"]
    temperature = hub.get("/skills/temperature_monitoring", headers=USER).json()
    assert temperature["available_spaces"] == []  # no room has a temperature sensor


FLOWS = [
    {"flow": "scn-A1", "agents": ["desktop", "orchestrator", "room1"], "accepted": True},
    {"flow": "scn-B1", "agents": ["smartphone", "orchestrator"], "accepted": True},
    {"flow": "scn-C1", "agents": ["room1"], "accepted": False},
]


def collector_with(flows: list[dict], seen: list[httpx.Request]) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=flows)

    return httpx.MockTransport(handle)


def test_agent_activity_joins_the_hub_record_and_the_collector_flows():
    seen: list[httpx.Request] = []
    app = create_app(
        load_config(env=ENV),
        "sqlite://",
        sync_cards=False,
        collector_url="http://collector.test",
        collector_transport=collector_with(FLOWS, seen),
    )
    with TestClient(app) as hub:
        free_room1(hub)
        r = hub.get("/agents/room1/activity", headers=USER)
        assert r.status_code == 200
        activity = r.json()
        assert activity["collector"] == "ok"
        assert [f["flow"] for f in activity["flows"]] == ["scn-A1", "scn-C1"]
        assert [e["action"] for e in activity["hub"]] == ["disconnect", "register"]
        assert seen[0].headers["Authorization"] == "Bearer t-dashboard"  # read-only token
        assert seen[0].url.params["limit"] == "100"
        assert hub.get("/agents/nope/activity", headers=USER).status_code == 404


def test_agent_activity_without_the_collector(hub):
    assert (
        hub.get("/agents/room1/activity", headers=USER)
        .json()["collector"]
        .startswith("not configured")
    )

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    app = create_app(
        load_config(env=ENV),
        "sqlite://",
        sync_cards=False,
        collector_url="http://collector.test",
        collector_transport=httpx.MockTransport(down),
    )
    with TestClient(app) as other:
        activity = other.get("/agents/room1/activity", headers=USER).json()
        assert activity["collector"] == "unreachable: ConnectError" and activity["flows"] == []
        assert activity["hub"][0]["action"] == "register"
