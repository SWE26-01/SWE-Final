"""The Collector's event log: append-only, one JSON row per event.

PostgreSQL in Docker (database `collector`, common/db.py), a SQLite file everywhere else. Next to
the JSON, each row keeps what the queries need (flow, agent, ts) and when the event arrived."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import UTC, datetime

from sqlalchemy import (
    URL,
    Column,
    Engine,
    Integer,
    MetaData,
    Table,
    Text,
    func,
    inspect,
    select,
    text,
)

from collector.events import AgentEvent
from collector.flows import StoredEvent, flow_of
from common.db import ensure_database, make_engine

log = logging.getLogger("collector")

metadata = MetaData()
events = Table(
    "events",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("json", Text),
    Column("flow", Text),
    Column("agent", Text),
    Column("ts", Text),  # the agent's own clock
    Column("received_at", Text),  # the Collector's clock
)
_DERIVED = ("flow", "agent", "ts")  # filled from the JSON for rows of an older schema
_READ = (events.c.id, events.c.json, events.c.flow, events.c.received_at)


def store_url(target: str | URL) -> str | URL:
    """A database URL, or a plain SQLite file path (tests, `COLLECTOR_DB`)."""
    return target if isinstance(target, URL) or "://" in target else f"sqlite:///{target}"


class EventStore:
    """Use from the event loop thread only (calls are short and synchronous)."""

    def __init__(self, target: str | URL) -> None:
        self._url = store_url(target)
        self._engine: Engine | None = None

    def open(self) -> None:
        ensure_database(self._url)
        self._engine = make_engine(self._url)
        metadata.create_all(self._engine)
        have = {c["name"] for c in inspect(self._engine).get_columns("events")}
        with self._engine.begin() as db:
            for name in ("flow", "agent", "ts", "received_at"):
                if name not in have:  # database from before that column
                    db.execute(text(f"ALTER TABLE events ADD COLUMN {name} TEXT"))
            if not set(_DERIVED) <= have:
                for event_id, raw in db.execute(select(events.c.id, events.c.json)).all():
                    db.execute(
                        events.update().where(events.c.id == event_id).values(**_derived(raw))
                    )
            db.execute(text("CREATE INDEX IF NOT EXISTS events_flow ON events (flow)"))
            db.execute(text("CREATE INDEX IF NOT EXISTS events_agent ON events (agent)"))

    def import_sqlite(self, path: str) -> int:
        """Copy the events of the SQLite file the Collector used before PostgreSQL, once: only into
        an empty log. Returns how many were copied."""
        if not os.path.exists(path):
            return 0
        with self._db.begin() as db:
            if db.execute(select(func.count()).select_from(events)).scalar():
                return 0
            src = sqlite3.connect(path)
            try:
                cols = [c[1] for c in src.execute("PRAGMA table_info(events)")]
                if "json" not in cols:
                    return 0
                arrived = "received_at" if "received_at" in cols else "NULL"
                rows = src.execute(f"SELECT json, {arrived} FROM events ORDER BY id").fetchall()
            finally:
                src.close()
            for raw, received_at in rows:
                db.execute(
                    events.insert().values(json=raw, received_at=received_at, **_derived(raw))
                )
        log.info("imported %d events from %s", len(rows), path)
        return len(rows)

    def close(self) -> None:
        if self._engine is not None:
            self._engine.dispose()
            self._engine = None

    def add(self, event: AgentEvent) -> StoredEvent:
        raw = event.stored()
        derived = _derived(raw)  # ts as the agent wrote it, flow from its request id
        # The Collector's own clock, so events from different hosts sort the same way
        # (an agent's `ts` comes from its own machine, which can drift).
        received_at = datetime.now(UTC).isoformat()
        with self._db.begin() as db:
            result = db.execute(
                events.insert().values(json=raw, received_at=received_at, **derived)
            )
        return _row(result.inserted_primary_key[0], raw, derived["flow"], received_at)

    def after(self, after_id: int, limit: int) -> list[StoredEvent]:
        query = select(*_READ).where(events.c.id > after_id).order_by(events.c.id).limit(limit)
        return self._rows(query)

    def latest(self, n: int) -> list[StoredEvent]:
        """The last `n` events, oldest first."""
        return self._rows(select(*_READ).order_by(events.c.id.desc()).limit(n))[::-1]

    def flow_events(self, flow: str) -> list[StoredEvent]:
        return self._rows(select(*_READ).where(events.c.flow == flow).order_by(events.c.id))

    def activity(self) -> dict[str, tuple[str, int]]:
        """agent id -> (`ts` of its latest event, number of events)."""
        with self._db.connect() as db:
            rows = db.execute(
                select(events.c.agent, func.max(events.c.id), func.count())
                .where(events.c.agent.is_not(None))
                .group_by(events.c.agent)
            ).all()
            ids = [r[1] for r in rows]
            ts = (
                dict(db.execute(select(events.c.id, events.c.ts).where(events.c.id.in_(ids))).all())
                if ids
                else {}
            )
        return {agent: (ts[last_id], count) for agent, last_id, count in rows}

    def recent_flows(self, limit: int) -> list[str]:
        """Flows with the most recent activity first."""
        query = (
            select(events.c.flow)
            .where(events.c.flow.is_not(None))
            .group_by(events.c.flow)
            .order_by(func.max(events.c.id).desc())
            .limit(limit)
        )
        with self._db.connect() as db:
            return [r[0] for r in db.execute(query)]

    def _rows(self, query) -> list[StoredEvent]:  # noqa: ANN001 (a Select)
        with self._db.connect() as db:
            return [_row(*r) for r in db.execute(query)]

    @property
    def _db(self) -> Engine:
        if self._engine is None:
            raise RuntimeError("event store is not open (app not started)")
        return self._engine


def _derived(raw: str) -> dict[str, str | None]:
    body = json.loads(raw)
    return {
        "flow": flow_of(body.get("request_id")),
        "agent": body.get("agent"),
        "ts": body.get("ts"),
    }


def _row(event_id: int | None, raw: str, flow: str | None, received_at: str | None) -> StoredEvent:
    row = {"id": event_id, **json.loads(raw)}
    if flow is not None:
        row["flow"] = flow
    if received_at is not None:
        row["received_at"] = received_at
    return row
