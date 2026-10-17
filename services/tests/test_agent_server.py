"""Agent server template end to end: real A2A JSON-RPC over an in-process ASGI transport."""

import httpx
import pytest

from agents.common.client import AgentClient
from agents.common.router import HandlerContext, Router
from agents.common.server import create_agent_app
from agents.run import build_app
from ambient.a2a_codec import AMBIENT_EXT_URI
from ambient.schemas import (
    ContextUpdate,
    ControlResult,
    DeviceAction,
    DeviceControl,
    ReasonCode,
)
from homeconfig import load_config

CONFIG = load_config()


def room_router() -> Router:
    router = Router()

    @router.on("device.control", "Control a device in my_room")
    async def control(msg: DeviceControl, ctx: HandlerContext) -> ControlResult:
        if msg.action.command == "EXPLODE":
            raise RuntimeError("boom")
        accepted = msg.action.command != "TURN_OFF"
        return ControlResult(
            request_id=msg.request_id,
            accepted=accepted,
            reason_code=msg.reason_code if accepted else ReasonCode.OCCUPIED,
        )

    return router


@pytest.fixture
def apps():
    return {
        "my-room-user1": create_agent_app(CONFIG, "my-room-user1", room_router()),
        "home-agent": build_app(CONFIG, "home-agent"),  # no agents/home/app.py yet
    }


@pytest.fixture
async def home_client(apps):
    def http_for(agent):
        transport = httpx.ASGITransport(app=apps[agent.id])
        return httpx.AsyncClient(transport=transport, base_url=agent.url)

    async with AgentClient(CONFIG, "home-agent", http_client_factory=http_for) as client:
        yield client


def control(command: str) -> DeviceControl:
    return DeviceControl(
        request_id=f"req-{command}",
        requester="home-agent",
        target="my-room-user1",
        action=DeviceAction(device="my_room_ac", command=command),
        reason_code=ReasonCode.ENERGY_SAVING,
    )


async def test_agent_card_comes_from_config(apps):
    transport = httpx.ASGITransport(app=apps["my-room-user1"])
    async with httpx.AsyncClient(transport=transport, base_url="http://my-room") as http:
        card = (await http.get("/.well-known/agent-card.json")).json()
    ext = card["capabilities"]["extensions"][0]
    assert card["name"] == "my-room-user1"
    assert card["supportedInterfaces"][0]["url"] == "http://my-room:9101"
    assert ext["uri"] == AMBIENT_EXT_URI
    assert ext["params"]["spaces"] == ["my_room"]
    assert [s["id"] for s in card["skills"]] == ["device.control"]


async def test_accepted_request_completes_with_reply(home_client):
    res = await home_client.send("my-room-user1", control("SET_MODE"))
    assert res.state == "TASK_STATE_COMPLETED"
    assert res.reply == ControlResult(
        request_id="req-SET_MODE", accepted=True, reason_code=ReasonCode.ENERGY_SAVING
    )


async def test_refused_request_is_rejected_with_reason(home_client):
    res = await home_client.send("my-room-user1", control("TURN_OFF"))
    assert res.state == "TASK_STATE_REJECTED"
    assert isinstance(res.reply, ControlResult)
    assert res.reply.reason_code is ReasonCode.OCCUPIED


async def test_unhandled_message_type_is_rejected(home_client):
    update = ContextUpdate(
        source="home-agent",
        subject="user1",
        sequence="1",
        expires_at="2099-01-01T00:00:00+00:00",
        data={"presence": "HOME"},
    )
    res = await home_client.send("my-room-user1", update)
    assert res.state == "TASK_STATE_REJECTED"
    assert res.reply is None


async def test_handler_error_fails_the_task(home_client):
    res = await home_client.send("my-room-user1", control("EXPLODE"))
    assert res.state == "TASK_STATE_FAILED"


async def test_agent_without_implementation_still_serves_card(apps):
    transport = httpx.ASGITransport(app=apps["home-agent"])
    async with httpx.AsyncClient(transport=transport, base_url="http://home") as http:
        card = (await http.get("/.well-known/agent-card.json")).json()
    assert card["name"] == "home-agent"
    assert card.get("skills", []) == []
