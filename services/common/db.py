"""Database engine for the Agent Hub and Studio: PostgreSQL in Docker, SQLite everywhere else."""

from __future__ import annotations

import os
from collections.abc import Mapping

from sqlalchemy import URL, Engine, create_engine
from sqlalchemy.pool import StaticPool


def database_url(name: str, env: Mapping[str, str] | None = None) -> URL | str:
    """URL of database `name` (hub, studio).

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
