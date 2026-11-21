"""Databases made by an older version keep working: new columns are added, and the Collector's
old SQLite log is copied into its new database once."""

import json
import sqlite3

from sqlalchemy import create_engine, inspect, text

from agenthub.store import Base as HubBase
from collector.store import EventStore
from common.db import add_missing_columns


def test_old_hub_agents_table_gets_the_new_columns(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'hub.sqlite'}")
    with engine.begin() as db:
        db.execute(text("CREATE TABLE agents (id VARCHAR(64) PRIMARY KEY, name VARCHAR(80))"))
        db.execute(text("INSERT INTO agents (id, name) VALUES ('room1', 'room1')"))
    added = add_missing_columns(engine, HubBase.metadata)
    assert {"agents.created_by", "agents.shared"} <= set(added)
    columns = {c["name"] for c in inspect(engine).get_columns("agents")}
    assert {"created_by", "shared", "removed"} <= columns
    with engine.connect() as db:
        assert db.execute(text("SELECT shared FROM agents")).scalar() in (0, False)
    assert add_missing_columns(engine, HubBase.metadata) == []  # nothing left to add


def test_collector_imports_its_old_sqlite_log_once(tmp_path):
    old = tmp_path / "old.sqlite"
    conn = sqlite3.connect(old)
    with conn:
        conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT)")
        for i in range(3):
            body = {
                "ts": f"2026-11-20T00:00:0{i}Z",
                "agent": "room1",
                "dir": "in",
                "request_id": "req-9",
            }
            conn.execute("INSERT INTO events (json) VALUES (?)", (json.dumps(body),))
    conn.close()
    store = EventStore(str(tmp_path / "new.sqlite"))
    store.open()
    try:
        assert store.import_sqlite(str(old)) == 3
        assert store.import_sqlite(str(old)) == 0  # only into an empty log
        assert store.recent_flows(5) == ["req-9"]
        assert store.activity() == {"room1": ("2026-11-20T00:00:02Z", 3)}
        assert store.import_sqlite(str(tmp_path / "missing.sqlite")) == 0
    finally:
        store.close()
