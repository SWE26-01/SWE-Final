"""A2A v1.0 / a2a-sdk 1.2.2 spike: extension negotiation, metadata validation,
INPUT_REQUIRED approval round-trip. Run: python spike.py"""
import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import uvicorn
from fastapi import FastAPI
from google.protobuf.json_format import MessageToDict
from pydantic import BaseModel, ValidationError

from a2a.client import ClientCallContext, ClientConfig, create_client
from a2a.client.service_parameters import ServiceParametersFactory, with_a2a_extensions
from a2a.helpers.proto_helpers import new_data_part, new_task_from_user_message, new_text_part
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes.agent_card_routes import create_agent_card_routes
from a2a.server.routes.fastapi_routes import add_a2a_routes_to_fastapi
from a2a.server.routes.jsonrpc_routes import create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types.a2a_pb2 import (
    AgentCapabilities, AgentCard, AgentExtension, AgentInterface, AgentSkill,
    Message, Role, SendMessageRequest, TaskState,
)
from a2a.utils.errors import ExtensionSupportRequiredError

EXT = "https://ambient-a2a.dev/ext/home/v1"
PORT = 9101
BASE = f"http://127.0.0.1:{PORT}"


# ---- extension schema (the part you write yourself) ----
class Context(BaseModel):
    entity_id: str
    context_version: int
    observed_at: datetime
    expires_at: datetime


class Approval(BaseModel):
    approved: bool
    action_hash: str


def ext_meta(msg: Message) -> dict:
    meta = MessageToDict(msg.metadata) if msg.HasField("metadata") else {}
    return {k.removeprefix(EXT + "/"): v for k, v in meta.items() if k.startswith(EXT)}


class DiagnoseExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        # 1) extension negotiation: SDK parses the header for us
        if EXT not in context.requested_extensions:
            raise ExtensionSupportRequiredError(message=f"{EXT} required")

        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        if context.current_task is None:
            await event_queue.enqueue_event(new_task_from_user_message(context.message))
        meta = ext_meta(context.message)

        # 2a) follow-up turn carrying approval
        if "approval" in meta:
            ap = Approval(**meta["approval"])
            await updater.add_artifact([new_data_part({"executed": ap.approved, "action_hash": ap.action_hash})],
                                       name="execution_result")
            await updater.complete()
            return

        # 2b) first turn: validate context payload
        try:
            ctx = Context(**meta.get("context", {}))
        except ValidationError as e:
            await updater.reject(updater.new_agent_message([new_text_part(f"schema error: {e.error_count()} field(s)")]))
            return
        if ctx.expires_at < datetime.now(timezone.utc):
            await updater.reject(updater.new_agent_message([new_text_part("context expired")]))
            return

        # 3) ask for approval via INPUT_REQUIRED + metadata substate
        await updater.requires_input(updater.new_agent_message(
            [new_text_part("approval needed: ac.set_mode=dry")],
            metadata={f"{EXT}/authorization": {"substate": "awaiting_user_approval",
                                               "action_hash": "sha256:abc"}},
        ))

    async def cancel(self, context, event_queue):  # not used
        pass


card = AgentCard(
    name="Diagnose Agent", description="spike", version="0.1.0",
    supported_interfaces=[AgentInterface(url=BASE, protocol_binding="JSONRPC", protocol_version="1.0")],
    capabilities=AgentCapabilities(streaming=True, extensions=[
        AgentExtension(uri=EXT, description="home coordination", required=True,
                       params={"maxContextAgeMs": 30000})]),
    default_input_modes=["application/json"], default_output_modes=["application/json"],
    skills=[AgentSkill(id="diagnose_device", name="diagnose", description="d", tags=["diag"])],
)
handler = DefaultRequestHandler(agent_executor=DiagnoseExecutor(), task_store=InMemoryTaskStore(), agent_card=card)
app = FastAPI()
add_a2a_routes_to_fastapi(app, agent_card_routes=create_agent_card_routes(card),
                          jsonrpc_routes=create_jsonrpc_routes(handler, rpc_url="/"))


def make_msg(meta: dict, task_id: str = "", context_id: str = "") -> Message:
    m = Message(message_id=str(uuid.uuid4()), role=Role.ROLE_USER, parts=[new_text_part("diagnose ac")],
                task_id=task_id, context_id=context_id)
    if meta:
        m.metadata.update({f"{EXT}/{k}": v for k, v in meta.items()})
    return m


async def send(client, msg, with_ext=True):
    ctx = ClientCallContext(service_parameters=ServiceParametersFactory.create([with_a2a_extensions([EXT])])) if with_ext else None
    last = None
    try:
        async for ev in client.send_message(SendMessageRequest(message=msg), context=ctx):
            last = ev
    except Exception as e:  # noqa: BLE001
        return f"EXCEPTION {type(e).__name__}: {e}"
    return last


def state_of(ev):
    if isinstance(ev, str):
        return ev, None, {}
    d = MessageToDict(ev)
    t = d.get("task") or {}
    st = (t.get("status") or d.get("statusUpdate", {}).get("status") or {})
    return st.get("state"), t.get("id") or d.get("statusUpdate", {}).get("taskId"), d


async def main():
    server = uvicorn.Server(uvicorn.Config(app, port=PORT, log_level="warning"))
    srv = asyncio.create_task(server.serve())
    await asyncio.sleep(1.0)
    now = datetime.now(timezone.utc)
    good_ctx = {"entity_id": "living-room-ac", "context_version": 42,
                "observed_at": now.isoformat(), "expires_at": (now + timedelta(seconds=30)).isoformat()}

    async with httpx.AsyncClient() as h:
        r = await h.get(f"{BASE}/.well-known/agent-card.json")
        print("T1 card extensions:", r.json()["capabilities"].get("extensions"))

    for streaming in (False, True):
        print(f"\n===== streaming={streaming} =====")
        client = await create_client(card, client_config=ClientConfig(streaming=streaming))
        print("T2 no ext header      ->", state_of(await send(client, make_msg({"context": good_ctx}), with_ext=False))[0])
        print("T3 bad schema         ->", state_of(await send(client, make_msg({"context": {"entity_id": "x"}})))[::2])
        exp = dict(good_ctx, expires_at=(now - timedelta(seconds=1)).isoformat())
        print("T4 expired context    ->", state_of(await send(client, make_msg({"context": exp})))[::2])
        s, tid, d = state_of(await send(client, make_msg({"context": good_ctx})))
        sm = (d.get("task") or {}).get("status", {}).get("message", {}).get("metadata") or \
             d.get("statusUpdate", {}).get("status", {}).get("message", {}).get("metadata")
        print("T5 valid -> ", s, "| status msg metadata:", sm)
        ctx_id = (d.get("task") or {}).get("contextId") or d.get("statusUpdate", {}).get("contextId")
        s2, _, d2 = state_of(await send(client, make_msg({"approval": {"approved": True, "action_hash": "sha256:abc"}},
                                                         task_id=tid, context_id=ctx_id)))
        print("T6 approval same task ->", s2, "| artifacts:", (d2.get("task") or {}).get("artifacts") or d2.get("artifactUpdate"))
        await client.close()

    # raw wire format + response header echo
    async with httpx.AsyncClient() as h:
        body = {"jsonrpc": "2.0", "id": "1", "method": "SendMessage",
                "params": {"message": {"messageId": "raw-1", "role": "ROLE_USER", "parts": [{"text": "hi"}],
                                       "metadata": {f"{EXT}/context": good_ctx}}}}
        r = await h.post(BASE + "/", json=body, headers={"A2A-Version": "1.0", "A2A-Extensions": EXT})
        print("\nT7 raw HTTP", r.status_code, "| response A2A-Extensions header:", r.headers.get("A2A-Extensions"))
        print("   raw result:", json.dumps(r.json())[:400])
        r = await h.post(BASE + "/", json=body | {"method": "message/send"}, headers={"A2A-Version": "1.0", "A2A-Extensions": EXT})
        print("T8 v0.3 method name   ->", r.status_code, json.dumps(r.json())[:200])

    server.should_exit = True
    await srv


asyncio.run(main())
