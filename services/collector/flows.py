"""Requests followed across agents: all events whose request_id starts with the same `<id>`.

Agents keep one request_id through delegation and execution and add `/<part>` for sub-requests,
so the part before the first `/` names a flow.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import AwareDatetime, BaseModel, Field

from collector.events import Action

# {"id": int, "flow"?: str, "received_at"?: str, **event as the agent logged it}
StoredEvent = dict[str, Any]


def flow_of(request_id: str | None) -> str | None:
    return request_id.split("/", 1)[0] if request_id else None


def in_time_order(events: list[StoredEvent]) -> list[StoredEvent]:
    """Order by when each event happened (`ts`), then by arrival (`id`). Agents post their lines
    concurrently, so arrival order can differ from the order things happened."""
    return sorted(events, key=lambda e: (datetime.fromisoformat(e["ts"]), e["id"]))


class Flow(BaseModel):
    """Summary of one request for dashboards; GET /flows/{flow} has its events."""

    flow: str
    first_id: int = Field(description="lowest event id (ids are arrival order)")
    last_id: int = Field(description="highest event id; flows are listed by it, newest first")
    started_at: AwareDatetime = Field(description="`ts` of the earliest event")
    ended_at: AwareDatetime = Field(description="`ts` of the latest event")
    agents: list[str] = Field(description="agents that logged events, in order of appearance")
    events: int
    requester: str | None = Field(
        description="who asked: the sender to the first agent, or the agent whose rule fired"
    )
    entry: str | None = Field(description="agent that received the request and gave the answer")
    action: Action | None = None
    accepted: bool | None = Field(description="final answer to the requester")
    reason_code: str | None = None


def summarize(flow: str, events: list[StoredEvent]) -> Flow:
    """`events` are one flow's events, in any order."""
    events = in_time_order(events)
    exact = [e for e in events if e.get("request_id") == flow]
    answers = [e for e in exact if e["dir"] == "in"]
    rules = [e for e in exact if e["dir"] == "rule"]
    if rules:  # a fired rule always starts a new flow
        head = rules[-1]
        requester = entry = head["agent"]
    elif answers:  # the first agent logs its answer last, after everything it waited for
        head = answers[-1]
        requester, entry = head.get("from"), head["agent"]
    else:  # e.g. only the sender's side was logged
        head = next((e for e in reversed(events) if "accepted" in e), events[-1])
        requester, entry = events[0]["agent"], None
    agents = list(dict.fromkeys(e["agent"] for e in events))
    return Flow(
        flow=flow,
        first_id=min(e["id"] for e in events),
        last_id=max(e["id"] for e in events),
        started_at=events[0]["ts"],
        ended_at=events[-1]["ts"],
        agents=agents,
        events=len(events),
        requester=requester,
        entry=entry,
        action=head.get("action"),
        accepted=head.get("accepted"),
        reason_code=head.get("reason_code"),
    )
