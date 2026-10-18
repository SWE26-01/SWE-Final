"""Event Collector (WBS W8-4): one audit log of every agent's A2A traffic and decisions.

The agents (../agents) POST each event-log line here with their own token. Dashboards read the log
with GET /events or live over WebSocket /ws.

Run: uvicorn collector.main:build --factory --port 8200 --env-file ../.env
     (database file: env COLLECTOR_DB, default collector.sqlite)
"""

import json
import os
import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import FastAPI, HTTPException, Query, WebSocket, status
from starlette.websockets import WebSocketDisconnect

from collector.events import AgentEvent
from common.auth import make_auth, ws_caller
from common.hub import Hub, push
from homeconfig import HomeConfig, load_config
from homeconfig.models import Role

SNAPSHOT_SIZE = 200  # events sent when a dashboard connects
MAX_LIMIT = 500  # page size cap for GET /events

StoredEvent = dict[str, Any]  # {"id": int, **event as the agent logged it}


class EventStore:
    """Append-only SQLite log, one JSON row per event. Use from the event loop thread only."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._conn: sqlite3.Connection | None = None

    def open(self) -> None:
        self._conn = sqlite3.connect(self._path)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT)"
        )
        self._conn.commit()

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def add(self, event: AgentEvent) -> StoredEvent:
        raw = event.stored()
        with self._db:
            cur = self._db.execute("INSERT INTO events (json) VALUES (?)", (raw,))
        return _row(cur.lastrowid, raw)

    def after(self, after_id: int, limit: int) -> list[StoredEvent]:
        rows = self._db.execute(
            "SELECT id, json FROM events WHERE id > ? ORDER BY id LIMIT ?", (after_id, limit)
        )
        return [_row(*r) for r in rows]

    def latest(self, n: int) -> list[StoredEvent]:
        """The last `n` events, oldest first."""
        rows = self._db.execute("SELECT id, json FROM events ORDER BY id DESC LIMIT ?", (n,))
        return [_row(*r) for r in rows][::-1]

    @property
    def _db(self) -> sqlite3.Connection:
        if self._conn is None:
            raise RuntimeError("event store is not open (app not started)")
        return self._conn


def _row(event_id: int | None, raw: str) -> StoredEvent:
    return {"id": event_id, **json.loads(raw)}


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
