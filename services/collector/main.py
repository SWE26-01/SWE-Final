"""Event Collector (WBS W8-4): audit log of A2A requests/responses and policy decisions.

Agents POST events; the dashboard reads them with GET /events or live over WebSocket /ws.
Run: uvicorn collector.main:app --port 8200   (database file: env COLLECTOR_DB)
"""

import asyncio
import json
import os
import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from collector.events import AgentEvent
from homeconfig import HomeConfig, load_config
from homeconfig.models import Agent, AgentRole

SNAPSHOT_SIZE = 200  # events sent when a dashboard connects
MAX_LIMIT = 500  # page size cap for GET /events
QUEUE_SIZE = 1000  # unsent events per WebSocket before the client is dropped

StoredEvent = dict[str, Any]  # {"id": int, **AgentEvent fields}
EventQueue = asyncio.Queue[StoredEvent | None]


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
        raw = event.model_dump_json(exclude_none=True)
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


class Hub:
    """Fans new events out to connected WebSockets. A queue that fills up is emptied and gets
    `None`, which tells its socket to close; the dashboard reconnects for a fresh snapshot."""

    def __init__(self) -> None:
        self._queues: set[EventQueue] = set()

    def subscribe(self) -> EventQueue:
        queue: EventQueue = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._queues.add(queue)
        return queue

    def unsubscribe(self, queue: EventQueue) -> None:
        self._queues.discard(queue)

    def publish(self, event: StoredEvent) -> None:
        for queue in list(self._queues):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                self._queues.discard(queue)
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(None)


def create_app(config: HomeConfig, db_path: str) -> FastAPI:
    """Build the collector. The database is opened at startup and closed at shutdown."""
    store = EventStore(db_path)
    hub = Hub()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        store.open()
        try:
            yield
        finally:
            store.close()

    app = FastAPI(title="Event Collector", lifespan=lifespan)
    bearer = HTTPBearer(auto_error=False)

    def authenticate(token: str | None) -> Agent | None:
        agent = config.agent_by_token(token) if token else None
        return agent if agent is not None and agent.enabled else None

    def caller(cred: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> Agent:
        agent = authenticate(cred.credentials if cred else None)
        if agent is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "missing or unknown token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return agent

    # Local alias: FastAPI resolves it at runtime, so no `from __future__ import annotations` here.
    Caller = Annotated[Agent, Depends(caller)]

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    # Handlers that touch the store or hub are async, so they all run on the event loop thread.
    @app.post("/events", status_code=status.HTTP_201_CREATED)
    async def post_event(event: AgentEvent, who: Caller) -> dict:
        if who.role is not AgentRole.AGENT:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "only agents report events")
        if event.agent != who.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"token belongs to {who.id!r}")
        if event.peer is not None and event.peer not in config.agents:
            raise HTTPException(422, f"unknown peer {event.peer!r}")
        stored = store.add(event)
        hub.publish(stored)
        return {"id": stored["id"]}

    @app.get("/events")
    async def list_events(
        who: Caller,
        after_id: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = 100,
    ) -> list[StoredEvent]:
        if who.role is not AgentRole.OPERATOR:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "only operators read events")
        return store.after(after_id, limit)

    @app.websocket("/ws")
    async def stream(websocket: WebSocket, token: str | None = None) -> None:
        # Browsers cannot set headers on a WebSocket, so the token comes in the query string.
        who = authenticate(token)
        if who is None or who.role is not AgentRole.OPERATOR:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        await websocket.accept()
        queue = hub.subscribe()
        try:
            # No await between subscribing and reading the snapshot, so nothing is missed.
            snapshot = store.latest(SNAPSHOT_SIZE)
            await websocket.send_json({"type": "snapshot", "events": snapshot})
            await _push(websocket, queue)
        except WebSocketDisconnect:
            pass
        finally:
            hub.unsubscribe(queue)

    return app


async def _push(websocket: WebSocket, queue: EventQueue) -> None:
    """Send queued events until the client disconnects or falls too far behind."""
    left = asyncio.create_task(_until_disconnect(websocket))
    get: asyncio.Task[StoredEvent | None] | None = None
    try:
        while True:
            get = asyncio.create_task(queue.get())
            await asyncio.wait({get, left}, return_when=asyncio.FIRST_COMPLETED)
            if left.done():
                return
            event = get.result()
            if event is None:
                await websocket.close(code=status.WS_1013_TRY_AGAIN_LATER)
                return
            await websocket.send_json({"type": "event", "event": event})
    finally:
        left.cancel()
        if get is not None:
            get.cancel()


async def _until_disconnect(websocket: WebSocket) -> None:
    while (await websocket.receive())["type"] != "websocket.disconnect":
        pass


app = create_app(load_config(), os.environ.get("COLLECTOR_DB", "collector.sqlite"))
