"""Agent server template: Agent Card + A2A JSON-RPC endpoint built from config (WBS W2-1)."""

from __future__ import annotations

import logging

from a2a.helpers.proto_helpers import new_task_from_user_message, new_text_part
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes.agent_card_routes import create_agent_card_routes
from a2a.server.routes.fastapi_routes import add_a2a_routes_to_fastapi
from a2a.server.routes.jsonrpc_routes import create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types.a2a_pb2 import (
    AgentCapabilities,
    AgentCard,
    AgentExtension,
    AgentInterface,
    AgentSkill,
)
from fastapi import FastAPI

from agents.common.router import HandlerContext, HandlerResult, Router
from ambient.a2a_codec import AMBIENT_EXT_URI, MEDIA_TYPE, from_parts, to_part
from homeconfig import HomeConfig
from homeconfig.models import Agent

log = logging.getLogger(__name__)

AMBIENT_VERSION = "1"


def build_agent_card(agent: Agent, router: Router) -> AgentCard:
    """Public card: where to reach the agent, what it shares and which messages it handles."""
    params = {
        "version": AMBIENT_VERSION,
        "kind": str(agent.kind),
        "spaces": agent.owned_spaces,
        "provides": agent.provides,
    }
    if agent.subject is not None:
        params["subject"] = agent.subject
    return AgentCard(
        name=agent.id,
        description=f"{agent.kind} agent ({agent.id})",
        version="0.1.0",
        supported_interfaces=[
            AgentInterface(url=agent.url, protocol_binding="JSONRPC", protocol_version="1.0")
        ],
        capabilities=AgentCapabilities(
            streaming=False,
            extensions=[
                AgentExtension(
                    uri=AMBIENT_EXT_URI,
                    description="Ambient-A2A smart-home extension",
                    required=False,
                    params=params,
                )
            ],
        ),
        default_input_modes=[MEDIA_TYPE],
        default_output_modes=[MEDIA_TYPE],
        skills=[
            AgentSkill(id=msg_type, name=msg_type, description=route.description, tags=["ambient"])
            for msg_type, route in router.routes.items()
        ],
    )


class AmbientExecutor(AgentExecutor):
    """Parse the Ambient message, run its handler, and record the outcome on the Task."""

    def __init__(self, agent_id: str, router: Router) -> None:
        self._agent_id = agent_id
        self._router = router

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        if context.current_task is None:
            await event_queue.enqueue_event(new_task_from_user_message(context.message))
        updater = TaskUpdater(event_queue, context.task_id, context.context_id)

        msg = from_parts(context.message.parts)
        if msg is None:
            await self._reject(updater, "expected an Ambient-A2A message in a DataPart")
            return
        route = self._router.get(msg.type)
        if route is None:
            await self._reject(updater, f"{self._agent_id} does not handle {msg.type!r}")
            return

        ctx = HandlerContext(
            agent_id=self._agent_id,
            caller_id=None,
            requested_extensions=frozenset(context.requested_extensions),
        )
        try:
            result = HandlerResult.of(await route.handler(msg, ctx))
        except Exception:
            log.exception("handler for %s failed", msg.type)
            await updater.failed(updater.new_agent_message([new_text_part("handler error")]))
            return

        if result.reply is not None:
            await updater.add_artifact([to_part(result.reply)], name=result.reply.type)
        if result.reject:
            await updater.reject()
        else:
            await updater.complete()

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        await TaskUpdater(event_queue, context.task_id, context.context_id).cancel()

    @staticmethod
    async def _reject(updater: TaskUpdater, reason: str) -> None:
        await updater.reject(updater.new_agent_message([new_text_part(reason)]))


def create_agent_app(config: HomeConfig, agent_id: str, router: Router) -> FastAPI:
    """FastAPI app serving the agent's card and A2A JSON-RPC endpoint at `/`."""
    agent = config.agent(agent_id)
    card = build_agent_card(agent, router)
    handler = DefaultRequestHandler(
        agent_executor=AmbientExecutor(agent_id, router),
        task_store=InMemoryTaskStore(),  # TODO(W2-2): DatabaseTaskStore + owner_resolver
        agent_card=card,
    )
    app = FastAPI(title=agent_id)
    add_a2a_routes_to_fastapi(
        app,
        agent_card_routes=create_agent_card_routes(card),
        jsonrpc_routes=create_jsonrpc_routes(handler, rpc_url="/"),
    )

    @app.get("/health")
    def health() -> dict:
        return {"ok": True, "agent": agent_id}

    return app
