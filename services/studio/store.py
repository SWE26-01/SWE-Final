"""Studio's table: one row per draft, from the user's request to the registered agent."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[str]: JSON, list[dict[str, Any]]: JSON}


class DraftRow(Base):
    __tablename__ = "drafts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    request: Mapped[str] = mapped_column(Text)
    # blocked (input guard), clarify, unsupported, invalid (harness after repairs), ready,
    # registered (approved: files written, agent in the Hub)
    status: Mapped[str] = mapped_column(String(16), index=True)
    filler: Mapped[str] = mapped_column(String(120))  # langchain:<model> or rules
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    suffix: Mapped[str] = mapped_column(String(8))  # keeps the agent id stable across retries
    question: Mapped[str | None] = mapped_column(String(300))
    reason: Mapped[str | None] = mapped_column(String(300))
    picks: Mapped[dict[str, Any]] = mapped_column(default=dict)  # skills and room the user chose
    findings: Mapped[list[dict[str, Any]]] = mapped_column(default=list)
    errors: Mapped[list[str]] = mapped_column(default=list)
    warnings: Mapped[list[str]] = mapped_column(default=list)
    slots: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    spec: Mapped[dict[str, Any] | None] = mapped_column(default=None)
    summary: Mapped[list[str]] = mapped_column(default=list)
    files: Mapped[dict[str, Any]] = mapped_column(default=dict)
    agent_id: Mapped[str | None] = mapped_column(String(64), index=True)
    port: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    registered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
