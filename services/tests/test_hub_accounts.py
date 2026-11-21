"""Accounts in the Agent Hub: sign up, log in, what each account sees, sharing, stars, installs,
and Studio drafts kept per account."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from support import ENV, STUDIO, USER, bearer
from test_agenthub import free_room1, meeting_agent

from agenthub.accounts import check_password, hash_password
from agenthub.main import create_app
from homeconfig import load_config
from studio.filler import RuleFiller
from studio.hubclient import HubClient
from studio.main import create_app as create_studio

CONFIG = load_config(env=ENV)


@pytest.fixture
def hub() -> Iterator[TestClient]:
    with TestClient(create_app(CONFIG, "sqlite://", sync_cards=False)) as c:
        yield c


def signup(hub: TestClient, username: str, name: str = "이름") -> dict[str, str]:
    r = hub.post("/auth/signup", json={"username": username, "name": name, "password": "secret1"})
    assert r.status_code == 201, r.text
    return bearer(r.json()["token"])


def ids(hub: TestClient, who: dict[str, str], query: str = "") -> set[str]:
    r = hub.get(f"/agents{query}", headers=who)
    assert r.status_code == 200, r.text
    return {a["id"] for a in r.json()}


def test_password_hash_round_trip():
    stored = hash_password("secret1")
    assert "secret1" not in stored
    assert check_password("secret1", stored)
    assert not check_password("secret2", stored)
    assert not check_password("secret1", "garbage")


def test_signup_login_me_logout(hub):
    alice = signup(hub, "alice", "앨리스")
    me = hub.get("/auth/me", headers=alice).json()
    assert me == {"id": "alice", "name": "앨리스", "role": "user", "member": True}

    again = hub.post("/auth/login", json={"username": "Alice", "password": "secret1"})
    assert again.status_code == 200 and again.json()["user"]["id"] == "alice"
    second = bearer(again.json()["token"])
    assert hub.get("/auth/me", headers=second).status_code == 200

    wrong = hub.post("/auth/login", json={"username": "alice", "password": "nope"})
    assert wrong.status_code == 401 and wrong.json()["detail"]["reason_code"] == "BAD_LOGIN"

    assert hub.post("/auth/logout", headers=alice).status_code == 204
    assert hub.get("/auth/me", headers=alice).status_code == 401  # that session only
    assert hub.get("/auth/me", headers=second).status_code == 200


def test_signup_refuses_taken_and_reserved_ids(hub):
    signup(hub, "alice")
    for username in ("alice", "home_user", "room1", "studio", "admin"):
        r = hub.post(
            "/auth/signup", json={"username": username, "name": "x", "password": "secret1"}
        )
        assert r.status_code == 409, username
        assert r.json()["detail"]["reason_code"] == "USERNAME_TAKEN"
    bad = hub.post("/auth/signup", json={"username": "A!", "name": "x", "password": "secret1"})
    assert bad.status_code == 422
    short = hub.post("/auth/signup", json={"username": "bob", "name": "x", "password": "12"})
    assert short.status_code == 422


def test_the_config_user_is_not_an_account(hub):
    me = hub.get("/auth/me", headers=USER).json()
    assert me["member"] is False and me["id"] == "home_user"
    assert hub.get("/auth/me").status_code == 401


def test_private_until_shared_then_others_find_star_and_install_it(hub):
    alice, bob = signup(hub, "alice", "앨리스"), signup(hub, "bob")
    agent_id = meeting_agent()["id"]
    reg = hub.post("/agents", json=meeting_agent(created_by="alice"), headers=STUDIO)
    assert reg.status_code == 201 and reg.json()["created_by"] == "alice"

    # Private: its maker and the config user see it, bob does not.
    assert agent_id in ids(hub, alice, "?mine=true")
    assert agent_id in ids(hub, USER)
    assert agent_id not in ids(hub, bob)
    assert {"room1", "desktop"} <= ids(hub, bob)  # the home's own agents are always there
    assert hub.get(f"/agents/{agent_id}", headers=bob).status_code == 404
    assert hub.post("/connections", json={"agent_id": agent_id}, headers=bob).status_code == 404

    # Only its maker shares it.
    no = hub.post(f"/agents/{agent_id}/share", json={"shared": True}, headers=bob)
    assert no.status_code == 404  # bob cannot even see it
    shared = hub.post(f"/agents/{agent_id}/share", json={"shared": True}, headers=alice)
    assert shared.status_code == 200 and shared.json()["shared"] is True

    catalog = hub.get("/agents?shared=true&q=앨리스", headers=bob).json()  # by the maker's name
    assert [a["id"] for a in catalog] == [agent_id]
    assert catalog[0]["creator_name"] == "앨리스" and catalog[0]["mine"] is False

    # bob stars it, and installs it into the home.
    star = hub.post(f"/agents/{agent_id}/star", json={"starred": True}, headers=bob).json()
    assert (star["stars"], star["starred"]) == (1, True)
    assert hub.get(f"/agents/{agent_id}", headers=alice).json()["starred"] is False
    free_room1(hub)
    r = hub.post("/connections", json={"agent_id": agent_id}, headers=bob)
    assert r.status_code == 201 and r.json()["created_by"] == "bob"
    assert hub.get(f"/agents/{agent_id}", headers=bob).json()["installs"] == 1

    # bob may not take it back or remove it; alice may.
    no = hub.post(f"/agents/{agent_id}/share", json={"shared": False}, headers=bob)
    assert no.status_code == 403 and no.json()["detail"]["reason_code"] == "NOT_CREATOR"
    assert hub.delete(f"/agents/{agent_id}", headers=bob).status_code == 403
    assert hub.delete(f"/agents/{agent_id}", headers=alice).status_code == 200


def test_connected_agents_are_seen_by_everyone_in_the_home(hub):
    signup(hub, "alice")
    bob = signup(hub, "bob")
    agent_id = meeting_agent()["id"]
    hub.post("/agents", json=meeting_agent(created_by="alice"), headers=STUDIO)
    free_room1(hub)
    assert hub.post("/connections", json={"agent_id": agent_id}, headers=USER).status_code == 201
    assert agent_id in ids(hub, bob)  # it runs the home's devices now


def test_catalog_sorts_by_stars(hub):
    alice = signup(hub, "alice")
    users = [signup(hub, f"user{i}") for i in range(2)]
    for suffix in ("aa11", "bb22"):
        body = meeting_agent(id=f"meeting-{suffix}", created_by="alice")
        assert hub.post("/agents", json=body, headers=STUDIO).status_code == 201
        hub.post(f"/agents/meeting-{suffix}/share", json={"shared": True}, headers=alice)
    for who in users:
        hub.post("/agents/meeting-bb22/star", json={"starred": True}, headers=who)
    hub.post("/agents/meeting-aa11/star", json={"starred": True}, headers=users[0])
    ranked = hub.get("/agents?shared=true&sort=stars", headers=alice).json()
    assert [(a["id"], a["stars"]) for a in ranked] == [("meeting-bb22", 2), ("meeting-aa11", 1)]
    assert hub.post("/agents/room1/star", json={"starred": True}, headers=USER).status_code == 403


def test_studio_keeps_drafts_per_account_and_registers_them_as_theirs(hub, tmp_path: Path):
    alice, bob = signup(hub, "alice"), signup(hub, "bob")
    as_studio = HubClient(TestClient(hub.app, headers=STUDIO))
    app = create_studio(CONFIG, RuleFiller(CONFIG), as_studio, "sqlite://", tmp_path / "gen")
    with TestClient(app) as studio:
        request = {"request": "회의할 때 내 방 조명을 회의 모드로 바꿔 줘", "space": "my_room"}
        d = studio.post("/drafts", json=request, headers=alice).json()
        assert d["owner"] == "alice" and d["status"] == "ready", d
        assert [x["id"] for x in studio.get("/drafts", headers=alice).json()] == [d["id"]]
        assert studio.get("/drafts", headers=bob).json() == []
        assert studio.get(f"/drafts/{d['id']}", headers=bob).status_code == 404
        assert studio.post(f"/drafts/{d['id']}/approve", headers=bob).status_code == 404
        assert len(studio.get("/drafts", headers=USER).json()) == 1  # the config user sees all

        assert studio.post(f"/drafts/{d['id']}/approve", headers=alice).status_code == 200
        agent = hub.get(f"/agents/{d['agent_id']}", headers=alice).json()
        assert (agent["created_by"], agent["mine"], agent["shared"]) == ("alice", True, False)
        assert studio.get("/drafts", headers=bearer("not-a-session")).status_code == 401
