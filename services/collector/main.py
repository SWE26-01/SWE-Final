"""Event Collector (WBS W8-4): one audit log of every agent's A2A traffic and decisions.

The agents (../agents) POST each event-log line here with their own token. Dashboards read the log
with GET /events or live over WebSocket /ws, and whole requests with GET /flows
(collector/flows.py).

With COLLECTOR_HUB_URL, agents the user connected in the Agent Hub post with their Hub-issued token
and are watched like the home's own agents (common/hublink.py).

Run: uvicorn collector.main:build --factory --port 8200 --env-file ../.env
     (database: PostgreSQL with POSTGRES_HOST, else the SQLite file COLLECTOR_DB, default
     collector.sqlite; collector/store.py)
"""

import asyncio
import contextlib
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import FastAPI, HTTPException, Query, WebSocket, status
from sqlalchemy import URL
from starlette.websockets import WebSocketDisconnect

from collector.agents import AgentStatus, AgentWatcher
from collector.events import AgentEvent
from collector.flows import Flow, StoredEvent, in_time_order, summarize
from collector.store import EventStore
from common.auth import make_auth, ws_caller
from common.cors import allow_dashboards
from common.db import database_url
from common.hub import Hub, push
from common.hublink import HubLink, agent_auth, hub_link
from common.logs import hide_tokens_in_server_logs
from homeconfig import HomeConfig, load_config
from homeconfig.models import Role

SNAPSHOT_SIZE = 200  # events sent when a dashboard connects
MAX_LIMIT = 500  # page size cap for GET /events
MAX_FLOWS = 100  # page size cap for GET /flows


def create_app(
    config: HomeConfig,
    db: str | URL,
    hub: Hub | None = None,
    *,
    watch_agents: bool = True,
    agent_transport: httpx.AsyncBaseTransport | None = None,
    hub_link_: HubLink | None = None,
    import_sqlite: str | None = None,
) -> FastAPI:
    """Build the collector. The database is opened at startup and closed at shutdown, and the
    agents' cards are checked in the background (`watch_agents=False` skips that, for tests).
    `db` is a database URL or a SQLite file path; `import_sqlite` names the SQLite file of an older
    Collector whose events are copied into an empty database once."""
    store = EventStore(db)
    hub = hub or Hub()

    def agent_statuses() -> list[AgentStatus]:
        activity = store.activity()
        statuses = []
        for agent in watcher.statuses.values():
            last_event_at, events = activity.get(agent.id, (None, 0))
            update = {"last_event_at": last_event_at, "events": events}
            statuses.append(AgentStatus.model_validate(agent.model_dump() | update))
        return statuses

    def agents_message() -> list[dict]:
        return [s.model_dump(mode="json") for s in agent_statuses()]

    watcher = AgentWatcher(
        config.agents(),
        on_change=lambda: hub.publish({"type": "agents", "agents": agents_message()}),
        transport=agent_transport,
        hub=hub_link_,
        agents_host=os.environ.get("AGENTS_HOST") or None,
    )
    auth = make_auth(config)
    agent = agent_auth(config, hub_link_)  # config agents, or agents connected in the Hub

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        store.open()
        if import_sqlite:
            store.import_sqlite(import_sqlite)
        task = asyncio.create_task(watcher.run()) if watch_agents else None
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            store.close()

    app = FastAPI(title="Event Collector", lifespan=lifespan)
    hide_tokens_in_server_logs()
    allow_dashboards(app, config)

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    # Handlers that touch the store or hub are async, so they all run on the event loop thread.
    @app.post("/events", status_code=status.HTTP_201_CREATED)
    async def post_event(event: AgentEvent, who: agent) -> dict:
        if event.agent != who.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"token belongs to {who.id!r}")
        stored = store.add(event)
        hub.publish({"type": "event", "event": stored})
        return {"id": stored["id"]}

    @app.get("/events")
    async def list_events(
        _: auth.operator,
        after_id: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 100,
    ) -> list[StoredEvent]:
        return store.after(after_id, limit)

    @app.get("/agents")
    async def list_agents(_: auth.operator) -> list[AgentStatus]:
        """Every configured agent: up or down (Agent Card check) and its latest activity."""
        return agent_statuses()

    @app.get("/flows")
    async def list_flows(
        _: auth.operator, limit: Annotated[int, Query(ge=1, le=MAX_FLOWS)] = 20
    ) -> list[Flow]:
        """Recent requests, most recently active first, each followed across agents."""
        return [summarize(f, store.flow_events(f)) for f in store.recent_flows(limit)]

    @app.get("/flows/{flow}")
    async def get_flow(flow: str, _: auth.operator) -> dict:
        events = in_time_order(store.flow_events(flow))
        if not events:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"no events for flow {flow!r}")
        return {"flow": summarize(flow, events).model_dump(mode="json"), "events": events}

    @app.websocket("/ws")
    async def follow_events(websocket: WebSocket, token: str | None = None) -> None:
        if ws_caller(config, token, Role.OPERATOR) is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        await websocket.accept()
        queue = hub.subscribe()
        try:
            # No await between subscribing and reading the snapshot, so nothing is missed.
            snapshot = {"type": "snapshot", "events": store.latest(SNAPSHOT_SIZE)}
            await websocket.send_json(snapshot | {"agents": agents_message()})
            await push(websocket, queue)
        except WebSocketDisconnect:
            pass
        finally:
            hub.unsubscribe(queue)

    return app


def build() -> FastAPI:
    """App for `uvicorn collector.main:build --factory` (config files + environment)."""
    config = load_config()
    old_file = os.environ.get("COLLECTOR_DB", "collector.sqlite")
    postgres = bool(os.environ.get("POSTGRES_HOST") or os.environ.get("COLLECTOR_DATABASE_URL"))
    return create_app(
        config,
        database_url("collector") if postgres else old_file,
        hub_link_=hub_link(config, os.environ.get("COLLECTOR_HUB_URL")),
        import_sqlite=old_file if postgres else None,
    )
