"""Hub tables: agents, connections (who is plugged into the home, with which permissions) and an
audit trail of every registration, connection and revocation."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


def now() -> datetime:
    return datetime.now(UTC)


def token_hash(token: str) -> str:
    """Only this is stored; the token itself is shown to the user once, at connection."""
    return hashlib.sha256(token.encode()).hexdigest()


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[str]: JSON}


class AgentRow(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(300), default="")
    # platform: the home's own agents (config/agents.yaml), studio: made in Studio,
    # external: registered from another server's Agent Card
    origin: Mapped[str] = mapped_column(String(16))
    role: Mapped[str | None] = mapped_column(String(16))  # Ambient-A2A role: room, home, external
    space: Mapped[str | None] = mapped_column(String(64))
    url: Mapped[str | None] = mapped_column(String(300))  # A2A base URL
    skills: Mapped[list[str]] = mapped_column(default=list)
    owned_devices: Mapped[list[str]] = mapped_column(default=list)
    provided_fields: Mapped[list[str]] = mapped_column(default=list)
    # What the agent needs to work; the user approves these (or a subset) when connecting.
    permissions: Mapped[list[str]] = mapped_column(default=list)
    spec_id: Mapped[str | None] = mapped_column(String(64))  # Studio draft it came from
    card: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    removed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class ConnectionRow(Base):
    __tablename__ = "connections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id"), index=True)
    space: Mapped[str | None] = mapped_column(String(64))
    permissions: Mapped[list[str]] = mapped_column(default=list)  # approved by the user
    # Hub-issued token (sha256). None for platform agents, whose token lives in the root .env.
    token_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    token_env: Mapped[str | None] = mapped_column(String(100))  # where the agent reads its token
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    created_by: Mapped[str] = mapped_column(String(64))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[str | None] = mapped_column(String(64))


class AuditRow(Base):
    __tablename__ = "audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(32))  # register, discover, connect, disconnect ...
    agent_id: Mapped[str | None] = mapped_column(String(64))
    connection_id: Mapped[str | None] = mapped_column(String(32))
    detail: Mapped[str] = mapped_column(String(300), default="")  # never a token or context value


def audit(
    db: Session,
    actor: str,
    action: str,
    agent_id: str | None = None,
    connection_id: str | None = None,
    detail: str = "",
) -> None:
    db.add(
        AuditRow(
            actor=actor,
            action=action,
            agent_id=agent_id,
            connection_id=connection_id,
            detail=detail[:300],
        )
    )


def active_connection(db: Session, agent_id: str) -> ConnectionRow | None:
    return db.scalars(
        select(ConnectionRow).where(ConnectionRow.agent_id == agent_id, ConnectionRow.active)
    ).first()


def owners(db: Session) -> dict[str, str]:
    """Device -> agent that owns it now: the `device:` permissions of active connections."""
    found: dict[str, str] = {}
    for c in db.scalars(select(ConnectionRow).where(ConnectionRow.active)):
        for p in c.permissions:
            if p.startswith("device:"):
                found[p.removeprefix("device:")] = c.agent_id
    return found
