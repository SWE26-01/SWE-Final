"""Provider-side subscription registry (plan doc 4.2)."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from ambient.schemas import ContextSubscribe, SubscribeResult


@dataclass
class Subscription:
    requester: str
    subject: str
    fields: frozenset[str]
    expires_at: datetime


class SubscriptionRegistry:
    def __init__(self) -> None:
        self._subs: dict[tuple[str, str], Subscription] = {}

    def subscribe(
        self, req: ContextSubscribe, allowed_fields: Iterable[str], now: datetime
    ) -> SubscribeResult:
        """Register only the fields the requester may see; report the rest as rejected."""
        allowed = set(allowed_fields)
        accepted = [f for f in req.fields if f in allowed]
        rejected = [f for f in req.fields if f not in allowed]
        expires_at = req.expires_at(now)
        if accepted:
            self._subs[(req.requester, req.subject)] = Subscription(
                req.requester, req.subject, frozenset(accepted), expires_at
            )
        return SubscribeResult(
            subject=req.subject,
            accepted_fields=accepted,
            rejected_fields=rejected,
            expires_at=expires_at,
        )

    def unsubscribe(self, requester: str, subject: str) -> None:
        self._subs.pop((requester, subject), None)

    def recipients(
        self, subject: str, changed: Iterable[str], now: datetime
    ) -> list[tuple[str, frozenset[str]]]:
        """Who should get this change, and which of the changed fields each may see.

        Expired subscriptions are dropped as a side effect.
        """
        for key in [k for k, s in self._subs.items() if now >= s.expires_at]:
            del self._subs[key]
        changed_set = set(changed)
        out = []
        for sub in self._subs.values():
            if sub.subject != subject:
                continue
            visible = sub.fields & changed_set
            if visible:
                out.append((sub.requester, visible))
        return out
