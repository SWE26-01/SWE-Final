import asyncio
import json
import threading
import time
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from support import DASHBOARD, ENV, ROOM1, SIMULATOR

from homeconfig import ConfigError, load_config
from homeconfig.models import Step
from runner.main import Runs, create_app
from runner.openclaw import OpenClaw
from runner.stream import REPLY_LIMIT

PORT_AGENT = {
    18800: "desktop",
    18920: "smartphone",
    19040: "orchestrator",
    19160: "room1",
    19280: "room2",
}


def answer(text: str, tokens: int = 1200) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "object": "chat.completion",
            "choices": [{"message": {"role": "assistant", "content": text}}],
            "usage": {"total_tokens": tokens},
        },
    )


class FakeOpenClaw:
    """The agents' OpenClaw gateways (POST /v1/chat/completions), recording what reached them."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.answers: dict[str, httpx.Response | Exception] = {}  # by agent, else a default reply
        self.gate: threading.Event | None = None  # set to hold every reply until it is released

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer t-openclaw"  # never an agent token
        self.requests.append(request)
        while self.gate is not None and not self.gate.is_set():
            await asyncio.sleep(0.01)
        agent = PORT_AGENT[request.url.port]
        found = self.answers.get(agent)
        if isinstance(found, Exception):
            raise found
        if found is not None:
            return found
        said = json.loads(request.content)["messages"][-1]["content"]
        return answer(f"{agent} heard: {said}")

    def said(self) -> list[tuple[str, str]]:
        return [
            (PORT_AGENT[r.url.port], json.loads(r.content)["messages"][-1]["content"])
            for r in self.requests
        ]


@pytest.fixture
def openclaw() -> FakeOpenClaw:
    return FakeOpenClaw()


@pytest.fixture
def client(openclaw: FakeOpenClaw) -> Iterator[TestClient]:
    app = create_app(load_config(env=ENV), openclaw_transport=httpx.MockTransport(openclaw))
    with TestClient(app) as c:
        yield c


def start(client: TestClient, body: dict) -> httpx.Response:
    return client.post("/runs", json=body, headers=SIMULATOR)


def finished(client: TestClient, run_id: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = client.get(f"/runs/{run_id}", headers=DASHBOARD).json()
        if run["status"] != "running":
            return run
        time.sleep(0.02)
    raise AssertionError(f"run {run_id} still running")


def test_scenarios_are_for_dashboards(client):
    assert client.get("/health").json() == {"ok": True, "running": False}
    for headers in (DASHBOARD, SIMULATOR):
        ids = [s["id"] for s in client.get("/scenarios", headers=headers).json()]
        assert ids == ["meeting", "away", "energy-check", "unauthorized", "reset"]
    assert client.get("/scenarios").status_code == 401
    assert client.get("/scenarios", headers=ROOM1).status_code == 403


@pytest.mark.parametrize("headers", [{}, DASHBOARD, ROOM1])
def test_only_the_simulator_starts_runs(client, openclaw, headers):
    resp = client.post("/runs", json={"scenario": "meeting"}, headers=headers)
    assert resp.status_code in (401, 403)
    assert openclaw.requests == []


def test_scenario_steps_are_said_in_order(client, openclaw):
    resp = start(client, {"scenario": "away"})
    assert resp.status_code == 202
    run = resp.json()
    assert (run["scenario"], run["title"], run["status"]) == ("away", "외출", "running")
    assert run["expect"]["input_boolean.room2_ac"] == "on"

    run = finished(client, run["id"])
    assert run["status"] == "done" and run["ended_at"]
    assert [(s["agent"], s["setup"], s["status"]) for s in run["steps"]] == [
        ("room1", True, "done"),
        ("room2", True, "done"),
        ("orchestrator", True, "done"),
        ("smartphone", False, "done"),
    ]
    assert run["steps"][3]["reply"] == "smartphone heard: 나 나간다"
    assert run["steps"][3]["tokens"] == 1200
    assert openclaw.said() == [(s["agent"], s["say"]) for s in run["steps"]]

    # Each agent's own gateway, the chat endpoint, one session for the whole run.
    request = openclaw.requests[0]
    assert (request.url.host, request.url.port, request.url.path) == (
        "127.0.0.1",
        19160,
        "/v1/chat/completions",
    )
    bodies = [json.loads(r.content) for r in openclaw.requests]
    assert {b["model"] for b in bodies} == {"openclaw/main"}
    assert {b["user"] for b in bodies} == {f"simulator-{run['id']}"}


def test_free_text_goes_to_one_agent(client, openclaw):
    run = start(client, {"agent": "desktop", "say": "나 회의 시작할게"}).json()
    assert (run["scenario"], run["title"]) == (None, "free text to desktop")
    run = finished(client, run["id"])
    assert run["status"] == "done"
    assert openclaw.said() == [("desktop", "나 회의 시작할게")]
    assert [r["id"] for r in client.get("/runs", headers=DASHBOARD).json()] == [run["id"]]


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ({"scenario": "nope"}, 404),
        ({"agent": "dashboard", "say": "hi"}, 422),  # not an agent
        ({"agent": "nobody", "say": "hi"}, 422),
        ({"agent": "desktop"}, 422),
        ({"agent": "desktop", "say": ""}, 422),
        ({"agent": "desktop", "say": "x" * 501}, 422),
        ({"scenario": "meeting", "agent": "desktop", "say": "hi"}, 422),
        ({"scenario": "meeting", "speed": 2}, 422),
        ({}, 422),
    ],
)
def test_bad_run_requests(client, openclaw, body, code):
    assert start(client, body).status_code == code
    assert openclaw.requests == []


def test_one_run_at_a_time(client, openclaw):
    openclaw.gate = threading.Event()
    first = start(client, {"scenario": "meeting"}).json()
    assert client.get("/health").json()["running"] is True
    busy = start(client, {"agent": "room1", "say": "조명 켜 줘"})
    assert busy.status_code == 409
    assert first["id"] in busy.json()["detail"]
    openclaw.gate.set()
    assert finished(client, first["id"])["status"] == "done"
    assert start(client, {"agent": "room1", "say": "조명 켜 줘"}).status_code == 202


def test_a_step_without_reply_stops_the_run(client, openclaw):
    openclaw.answers["room2"] = httpx.Response(404, json={"error": "not found"})
    run = finished(client, start(client, {"scenario": "away"}).json()["id"])
    assert run["status"] == "failed"
    assert [s["status"] for s in run["steps"]] == ["done", "failed", "skipped", "skipped"]
    assert "chat endpoint is off" in run["steps"][1]["error"]
    assert [agent for agent, _ in openclaw.said()] == ["room1", "room2"]


@pytest.mark.parametrize(
    ("reply", "error"),
    [
        (httpx.Response(401), "rejected OPENCLAW_GATEWAY_TOKEN"),
        (httpx.ConnectError("connection refused"), "desktop is not reachable"),
        (httpx.ReadTimeout("slow"), "did not answer within"),
        (httpx.Response(500, json={"error": {"message": "model down"}}), "HTTP 500: model down"),
        (httpx.Response(200, json={"choices": []}), "unexpected answer"),
        (answer("   "), "empty reply"),
    ],
)
def test_why_a_step_failed(client, openclaw, reply, error):
    openclaw.answers["desktop"] = reply
    run = finished(client, start(client, {"agent": "desktop", "say": "hi"}).json()["id"])
    (step,) = run["steps"]
    assert (run["status"], step["status"]) == ("failed", "failed")
    assert error in step["error"]


def test_long_replies_are_cut(client, openclaw):
    openclaw.answers["desktop"] = answer("가" * (REPLY_LIMIT + 50))
    run = finished(client, start(client, {"agent": "desktop", "say": "hi"}).json()["id"])
    assert len(run["steps"][0]["reply"]) == REPLY_LIMIT


def test_websocket_follows_runs(client):
    with client.websocket_connect("/ws?token=t-dashboard") as ws:
        assert ws.receive_json() == {"type": "snapshot", "runs": []}
        run_id = start(client, {"agent": "room1", "say": "조명 켜 줘"}).json()["id"]
        seen = []
        while not seen or seen[-1]["status"] == "running":
            msg = ws.receive_json()
            assert msg["type"] == "run.updated" and msg["run"]["id"] == run_id
            seen.append(msg["run"])
        assert [r["steps"][0]["status"] for r in seen] == ["pending", "running", "done", "done"]
        assert seen[-1]["status"] == "done"

    with client.websocket_connect("/ws?token=t-simulator") as ws:
        assert [r["id"] for r in ws.receive_json()["runs"]] == [run_id]


@pytest.mark.parametrize("query", ["", "?token=t-room1", "?token=nope"])
def test_websocket_is_for_dashboards_only(client, query):
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws{query}") as ws:
            ws.receive_json()
    assert exc.value.code == 1008


@pytest.mark.parametrize("missing", ["OPENCLAW_GATEWAY_TOKEN", "SIMULATOR_TOKEN"])
def test_runner_needs_its_tokens(missing):
    env = {k: v for k, v in ENV.items() if k != missing}
    with pytest.raises(ConfigError, match=f"{missing} is not set"):
        create_app(load_config(env=env))


async def test_stopping_mid_run_closes_the_run():
    config = load_config(env=ENV)

    async def never(_: httpx.Request) -> httpx.Response:
        await asyncio.sleep(3600)
        raise AssertionError("unreachable")

    openclaw = OpenClaw("t-openclaw", transport=httpx.MockTransport(never))
    runs = Runs(config, openclaw)
    run = runs.start("t", None, [Step(agent="room1", say="a"), Step(agent="room2", say="b")], {})
    await asyncio.sleep(0.05)
    await runs.stop()
    await openclaw.aclose()
    assert run.status == "failed"
    assert [s.status for s in run.steps] == ["failed", "skipped"]
    assert run.steps[0].error == "stopped before the agent answered"
