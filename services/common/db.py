"""Database engines for the Agent Hub, Studio and the Event Collector: PostgreSQL in Docker, SQLite
everywhere else."""

from __future__ import annotations

import os
import re
from collections.abc import Mapping

from sqlalchemy import URL, Engine, MetaData, create_engine, inspect, make_url, text
from sqlalchemy.pool import StaticPool


def database_url(name: str, env: Mapping[str, str] | None = None) -> URL | str:
    """URL of database `name` (hub, studio, collector).

    env <NAME>_DATABASE_URL wins. Otherwise, with POSTGRES_HOST set (docker-compose.yml),
    PostgreSQL database `name` with POSTGRES_USER / POSTGRES_PASSWORD from the root .env.
    Otherwise a SQLite file `<name>.sqlite` in the working directory, so tests and `uvicorn` runs
    need no database server."""
    env = os.environ if env is None else env
    explicit = env.get(f"{name.upper()}_DATABASE_URL")
    if explicit:
        return explicit
    host = env.get("POSTGRES_HOST")
    if host:
        return URL.create(
            "postgresql+psycopg",
            username=env.get("POSTGRES_USER", "ambient"),
            password=env.get("POSTGRES_PASSWORD") or None,
            host=host,
            port=int(env.get("POSTGRES_PORT", "5432")),
            database=name,
        )
    return f"sqlite:///{name}.sqlite"


def make_engine(url: URL | str) -> Engine:
    if str(url) in ("sqlite://", "sqlite:///:memory:"):  # tests: one shared in-memory database
        return create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
    if str(url).startswith("sqlite"):
        return create_engine(url, connect_args={"check_same_thread": False})
    return create_engine(url, pool_pre_ping=True)


def ensure_database(url: URL | str) -> None:
    """Create the PostgreSQL database of `url` if it is missing (a volume made before that service
    used PostgreSQL). SQLite creates its file by itself."""
    u = make_url(url)
    if not u.drivername.startswith("postgresql") or not u.database:
        return
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", u.database):
        raise ValueError(f"unexpected database name {u.database!r}")
    admin = create_engine(u.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as c:
            found = c.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": u.database}
            ).scalar()
            if found is None:
                c.execute(text(f'CREATE DATABASE "{u.database}"'))
    finally:
        admin.dispose()


def add_missing_columns(engine: Engine, metadata: MetaData) -> list[str]:
    """`create_all` makes missing tables but never changes an existing one: add the columns a newer
    model has, so an old database keeps working. New columns must be nullable or have a server
    default. Returns what was added, as table.column."""
    found = inspect(engine)
    added: list[str] = []
    with engine.begin() as db:
        for table in metadata.sorted_tables:
            if not found.has_table(table.name):
                continue
            have = {c["name"] for c in found.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = f"ALTER TABLE {table.name} ADD COLUMN {col.name} "
                ddl += col.type.compile(dialect=engine.dialect)
                if col.server_default is not None:
                    arg = col.server_default.arg  # type: ignore[attr-defined]
                    default = (
                        f"'{arg}'" if isinstance(arg, str) else arg.compile(dialect=engine.dialect)
                    )
                    ddl += f" DEFAULT {default}"
                db.execute(text(ddl))
                added.append(f"{table.name}.{col.name}")
    return added
