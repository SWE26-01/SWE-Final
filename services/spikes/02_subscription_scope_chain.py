"""Spike 2: context subscription Task, caller-scoped disclosure, Room->Desktop chaining.
a2a-sdk 1.2.2 / A2A v1.0. Run: python spike2.py"""
import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone

import uvicorn
from fastapi import FastAPI
from google.protobuf.json_format import MessageToDict

from a2a.client import ClientCallContext, ClientConfig, create_client
from a2a.client.service_parameters import ServiceParametersFactory, with_a2a_extensions
from a2a.helpers.proto_helpers import new_data_part, new_task_from_user_message, new_text_part
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.context import ServerCallContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes.agent_card_routes import create_agent_card_routes
from a2a.server.routes.common import DefaultServerCallContextBuilder
from a2a.server.routes.fastapi_routes import add_a2a_routes_to_fastapi
from a2a.server.routes.jsonrpc_routes import create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types.a2a_pb2 import (
    AgentCapabilities, AgentCard, AgentExtension, AgentInterface, AgentSkill,
    CancelTaskRequest, Message, Role, SendMessageRequest, SubscribeToTaskRequest,
)

EXT = "https://ambient-a2a.dev/ext/context/v1"
TOKENS = {"tok-room-u1": {"agent": "my-room-agent", "scope": "room:user1"},
          "tok-home": {"agent": "home-agent", "scope": "household"}}
T0 = time.perf_counter()


def log(*a):
    print(f"[{time.perf_counter() - T0:5.2f}s]", *a)


# ---------- caller identity: bearer token -> scope (custom context builder) ----------
class ScopedContextBuilder(DefaultServerCallContextBuilder):
    def build(self, request) -> ServerCallContext:
        ctx = super().build(request)
        tok = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        ctx.state["caller"] = TOKENS.get(tok)
        return ctx


def card(name, port, skill):
    return AgentCard(
        name=name, description=name, version="0.1.0",
        supported_interfaces=[AgentInterface(url=f"http://127.0.0.1:{port}", protocol_binding="JSONRPC", protocol_version="1.0")],
        capabilities=AgentCapabilities(streaming=True, extensions=[AgentExtension(uri=EXT, required=False)]),
        default_input_modes=["application/json"], default_output_modes=["application/json"],
        skills=[AgentSkill(id=skill, name=skill, description=skill, tags=["context"])])


def ext_meta(msg):
    meta = MessageToDict(msg.metadata) if msg.HasField("metadata") else {}
    return {k.removeprefix(EXT + "/"): v for k, v in meta.items() if k.startswith(EXT)}


# ---------- Desktop Agent: long-lived subscription Task with scoped disclosure ----------
class DesktopExecutor(AgentExecutor):
    def __init__(self):
        self.cancelled: dict[str, asyncio.Event] = {}

    def disclose(self, scope, seq, meeting_at):
        base = {"context_id": "desk-meeting", "sequence": str(seq), "source": "desktop-agent",
                "issued_at": datetime.now(timezone.utc).isoformat(),
                "valid_until": (datetime.now(timezone.utc) + timedelta(seconds=120)).isoformat()}
        if scope == "room:user1":   # owner's own room: activity-level summary
            return base | {"subject": "user1", "context_type": "upcoming_activity", "prediction": "video_meeting",
                           "expected_at": meeting_at.isoformat(), "confidence": "0.92",
                           "evidence": ["calendar_event", "meeting_app_launched"], "disclosure": "summary"}
        return base | {"subject": "user1", "context_type": "availability", "prediction": "busy",
                       "disclosure": "minimal"}   # household: coarse availability only

    async def execute(self, context: RequestContext, event_queue: EventQueue):
        caller = context.call_context.state.get("caller")
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await event_queue.enqueue_event(new_task_from_user_message(context.message))
        if caller is None:
            await updater.reject(updater.new_agent_message([new_text_part("unknown caller")]))
            return
        sub = ext_meta(context.message).get("subscribe")
        await updater.start_work()
        stop = self.cancelled.setdefault(context.task_id, asyncio.Event())
        now = datetime.now(timezone.utc)
        timeline = [(0.0, now + timedelta(minutes=10)), (1.0, now + timedelta(minutes=25)),  # meeting postponed
                    (1.0, now + timedelta(minutes=24))]
        if not sub:  # one-shot query
            timeline = timeline[:1]
        for seq, (delay, meeting_at) in enumerate(timeline, 1):
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
                return  # cancelled
            except asyncio.TimeoutError:
                pass
            await updater.add_artifact([new_data_part(self.disclose(caller["scope"], seq, meeting_at))],
                                       name="prediction_context", artifact_id=f"ctx-{seq}")
        if sub:  # keep subscription open until TTL or cancel
            try:
                await asyncio.wait_for(stop.wait(), timeout=float(sub.get("ttl_seconds", 5)))
                return
            except asyncio.TimeoutError:
                pass
        await updater.complete()

    async def cancel(self, context: RequestContext, event_queue: EventQueue):
        self.cancelled.setdefault(context.task_id, asyncio.Event()).set()
        await TaskUpdater(event_queue, context.task_id, context.context_id).cancel()


# ---------- My Room Agent: server that itself calls Desktop (chained A2A) ----------
class RoomExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue):
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)
        await event_queue.enqueue_event(new_task_from_user_message(context.message))
        t = time.perf_counter()
        desk = await create_client(f"http://127.0.0.1:9201", client_config=ClientConfig(streaming=False))
        last = None
        async for ev in desk.send_message(SendMessageRequest(message=msg({})), context=call_ctx("tok-room-u1")):
            last = ev
        await desk.close()
        ctx = MessageToDict(last)["task"]["artifacts"][-1]["parts"][0]["data"]
        decision = "pause_vacuum+meeting_lighting" if ctx.get("prediction") == "video_meeting" else "none"
        await updater.add_artifact([new_data_part({"decision": decision, "based_on": ctx["context_id"],
                                                   "desktop_rtt_ms": str(round((time.perf_counter() - t) * 1000, 1))})])
        await updater.complete()

    async def cancel(self, context, event_queue):
        pass


def make_app(executor, c):
    h = DefaultRequestHandler(agent_executor=executor, task_store=InMemoryTaskStore(), agent_card=c)
    app = FastAPI()
    add_a2a_routes_to_fastapi(app, agent_card_routes=create_agent_card_routes(c),
                              jsonrpc_routes=create_jsonrpc_routes(h, rpc_url="/", context_builder=ScopedContextBuilder()))
    return app


def msg(meta, text="context?"):
    m = Message(message_id=str(uuid.uuid4()), role=Role.ROLE_USER, parts=[new_text_part(text)])
    if meta:
        m.metadata.update({f"{EXT}/{k}": v for k, v in meta.items()})
    return m


def call_ctx(token):
    sp = ServiceParametersFactory.create([with_a2a_extensions([EXT])])
    if token:
        sp["Authorization"] = f"Bearer {token}"
    return ClientCallContext(service_parameters=sp)


def summarize(ev):
    d = MessageToDict(ev)
    if "artifactUpdate" in d:
        data = d["artifactUpdate"]["artifact"]["parts"][0]["data"]
        return f"artifactUpdate seq={data['sequence']} {data.get('prediction')} expected_at={data.get('expected_at', '-')[11:16]} disclosure={data['disclosure']}"
    if "statusUpdate" in d:
        return f"statusUpdate {d['statusUpdate']['status']['state']}"
    if "task" in d:
        return f"task {d['task']['status']['state']}"
    return str(d)[:80]


async def main():
    servers = [uvicorn.Server(uvicorn.Config(make_app(DesktopExecutor(), card("Desktop", 9201, "upcoming_activity")), port=9201, log_level="warning")),
               uvicorn.Server(uvicorn.Config(make_app(RoomExecutor(), card("MyRoom", 9202, "room_decision")), port=9202, log_level="warning"))]
    tasks = [asyncio.create_task(s.serve()) for s in servers]
    await asyncio.sleep(1.0)
    desk = await create_client("http://127.0.0.1:9201", client_config=ClientConfig(streaming=True))

    print("\n--- S1 subscription stream (Room scope), updates pushed over time ---")
    tid = None
    async for ev in desk.send_message(SendMessageRequest(message=msg({"subscribe": {"ttl_seconds": 1}})), context=call_ctx("tok-room-u1")):
        d = MessageToDict(ev)
        tid = tid or d.get("task", {}).get("id") or d.get("statusUpdate", {}).get("taskId")
        log(summarize(ev))

    print("\n--- S2 same query, Home (household) scope -> minimal disclosure ---")
    async for ev in desk.send_message(SendMessageRequest(message=msg({})), context=call_ctx("tok-home")):
        if "artifactUpdate" in MessageToDict(ev):
            log(summarize(ev))

    print("\n--- S3 no token -> rejected ---")
    async for ev in desk.send_message(SendMessageRequest(message=msg({})), context=call_ctx(None)):
        last = ev
    log(summarize(last))

    print("\n--- S4 drop stream after first update, then SubscribeToTask, then CancelTask ---")
    tid = None
    async for ev in desk.send_message(SendMessageRequest(message=msg({"subscribe": {"ttl_seconds": 30}})), context=call_ctx("tok-room-u1")):
        d = MessageToDict(ev)
        tid = tid or d.get("task", {}).get("id") or d.get("statusUpdate", {}).get("taskId") or d.get("artifactUpdate", {}).get("taskId")
        log("first stream:", summarize(ev))
        if "artifactUpdate" in d:
            break
    log("stream dropped; resubscribing to", tid[:8])
    n = 0
    async for ev in desk.subscribe(SubscribeToTaskRequest(id=tid), context=call_ctx("tok-room-u1")):
        log("resubscribed:", summarize(ev))
        n += 1
        if n == 3:
            break
    try:
        async for ev in desk.subscribe(SubscribeToTaskRequest(id=tid), context=call_ctx("tok-home")):
            log("HOME subscribed to ROOM's task:", summarize(ev)); break
    except Exception as e:
        log("HOME subscribe blocked:", type(e).__name__)
    try:
        async for ev in desk.subscribe(SubscribeToTaskRequest(id=tid), context=call_ctx(None)):
            log("NO-TOKEN subscribed to ROOM's task:", summarize(ev)); break
    except Exception as e:
        log("NO-TOKEN subscribe blocked:", type(e).__name__)
    r = await desk.cancel_task(CancelTaskRequest(id=tid), context=call_ctx("tok-room-u1"))
    log("cancel ->", MessageToDict(r)["status"]["state"])

    print("\n--- S5 chained: Home -> MyRoom -> Desktop (one-shot) ---")
    room = await create_client("http://127.0.0.1:9202", client_config=ClientConfig(streaming=False))
    t = time.perf_counter()
    async for ev in room.send_message(SendMessageRequest(message=msg({})), context=call_ctx("tok-home")):
        last = ev
    art = MessageToDict(last)["task"]["artifacts"][0]["parts"][0]["data"]
    log(f"room decision={art['decision']} | room->desktop {art['desktop_rtt_ms']}ms | end-to-end {round((time.perf_counter() - t) * 1000, 1)}ms")

    await desk.close(); await room.close()
    for s in servers:
        s.should_exit = True
    await asyncio.gather(*tasks)


asyncio.run(main())
