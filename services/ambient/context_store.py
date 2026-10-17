"""Keeps the latest valid context per (source, subject) (plan doc 4.1)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ambient.schemas import ContextUpdate


class ContextStore:
    def __init__(self) -> None:
        self._latest: dict[tuple[str, str], ContextUpdate] = {}

    def accept(self, update: ContextUpdate, now: datetime) -> bool:
        """Store the update unless it is expired or not newer than what we have."""
        if update.is_expired(now):
            return False
        key = (update.source, update.subject)
        current = self._latest.get(key)
        if current is not None and update.seq <= current.seq:
            return False
        self._latest[key] = update
        return True

    def get(self, source: str, subject: str, now: datetime) -> ContextUpdate | None:
        """Latest update that is still valid, or None."""
        update = self._latest.get((source, subject))
        if update is None or update.is_expired(now):
            return None
        return update

    def value(self, source: str, subject: str, field: str, now: datetime) -> Any:
        update = self.get(source, subject, now)
        return None if update is None else update.data.get(field)
