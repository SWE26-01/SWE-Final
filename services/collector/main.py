"""Event Collector (WBS W8-4): one audit log of every agent's A2A traffic and decisions.

The agents (../agents) POST each event-log line here with their own token. Dashboards read the log
with GET /events or live over WebSocket /ws, and whole requests with GET /flows
(collector/flows.py).

Run: uvicorn collector.main:build --factory --port 8200 --env-file ../.env
     (database file: env COLLECTOR_DB, default collector.sqlite)
"""

import json
import os
import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query, WebSocket, status
from starlette.websockets import WebSocketDisconnect

from collector.events import AgentEvent
from collector.flows import Flow, StoredEvent, flow_of, summarize
from common.auth import make_auth, ws_caller
from common.hub import Hub, push
from homeconfig import HomeConfig, load_config
from homeconfig.models import Role

SNAPSHOT_SIZE = 200  # events sent when a dashboard connects
MAX_LIMIT = 500  # page size cap for GET /events
MAX_FLOWS = 100  # page size cap for GET /flows


class EventStore:
    """Append-only SQLite log, one JSON row per event. Use from the event loop thread only."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._conn: sqlite3.Connection | None = None

    def open(self) -> None:
        self._conn = sqlite3.connect(self._path)
        with self._conn:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS events "
                "(id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT, flow TEXT)"
            )
            columns = [c[1] for c in self._conn.execute("PRAGMA table_info(events)")]
            if "flow" not in columns:  # database from before flows: add and fill the column
                self._conn.execute("ALTER TABLE events ADD COLUMN flow TEXT")
                for event_id, raw in self._conn.execute("SELECT id, json FROM events").fetchall():
                    flow = flow_of(json.loads(raw).get("request_id"))
                    self._conn.execute("UPDATE events SET flow = ? WHERE id = ?", (flow, event_id))
            self._conn.execute("CREATE INDEX IF NOT EXISTS events_flow ON events (flow)")

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def add(self, event: AgentEvent) -> StoredEvent:
        raw, flow = event.stored(), flow_of(event.request_id)
        with self._db:
            cur = self._db.execute("INSERT INTO events (json, flow) VALUES (?, ?)", (raw, flow))
        return _row(cur.lastrowid, raw, flow)

    def after(self, after_id: int, limit: int) -> list[StoredEvent]:
        rows = self._db.execute(
            "SELECT id, json, flow FROM events WHERE id > ? ORDER BY id LIMIT ?", (after_id, limit)
        )
        return [_row(*r) for r in rows]

    def latest(self, n: int) -> list[StoredEvent]:
        """The last `n` events, oldest first."""
        rows = self._db.execute(
            "SELECT id, json, flow FROM events ORDER BY id DESC LIMIT ?", (n,)
        )
        return [_row(*r) for r in rows][::-1]

    def flow_events(self, flow: str) -> list[StoredEvent]:
        rows = self._db.execute(
            "SELECT id, json, flow FROM events WHERE flow = ? ORDER BY id", (flow,)
        )
        return [_row(*r) for r in rows]

    def recent_flows(self, limit: int) -> list[str]:
        """Flows with the most recent activity first."""
        rows = self._db.execute(
            "SELECT flow FROM events WHERE flow IS NOT NULL "
            "GROUP BY flow ORDER BY MAX(id) DESC LIMIT ?",
            (limit,),
        )
        return [r[0] for r in rows]

    @property
    def _db(self) -> sqlite3.Connection:
        if self._conn is None:
            raise RuntimeError("event store is not open (app not started)")
        return self._conn


def _row(event_id: int | None, raw: str, flow: str | None) -> StoredEvent:
    row = {"id": event_id, **json.loads(raw)}
    if flow is not None:
        row["flow"] = flow
    return row


def create_app(config: HomeConfig, db_path: str, hub: Hub | None = None) -> FastAPI:
    """Build the collector. The database is opened at startup and closed at shutdown."""
    store = EventStore(db_path)
    hub = hub or Hub()
    auth = make_auth(config)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        store.open()
        try:
            yield
        finally:
            store.close()

    app = FastAPI(title="Event Collector", lifespan=lifespan)

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    # Handlers that touch the store or hub are async, so they all run on the event loop thread.
    @app.post("/events", status_code=status.HTTP_201_CREATED)
    async def post_event(event: AgentEvent, who: auth.agent) -> dict:
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

    @app.get("/flows")
    async def list_flows(
        _: auth.operator, limit: Annotated[int, Query(ge=1, le=MAX_FLOWS)] = 20
    ) -> list[Flow]:
        """Recent requests, most recently active first, each followed across agents."""
        return [summarize(f, store.flow_events(f)) for f in store.recent_flows(limit)]

    @app.get("/flows/{flow}")
    async def get_flow(flow: str, _: auth.operator) -> dict:
        events = store.flow_events(flow)
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
            snapshot = store.latest(SNAPSHOT_SIZE)
            await websocket.send_json({"type": "snapshot", "events": snapshot})
            await push(websocket, queue)
        except WebSocketDisconnect:
            pass
        finally:
            hub.unsubscribe(queue)

    return app


def build() -> FastAPI:
    """App for `uvicorn collector.main:build --factory` (config files + environment)."""
    return create_app(load_config(), os.environ.get("COLLECTOR_DB", "collector.sqlite"))
