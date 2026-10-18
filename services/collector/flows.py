"""Requests followed across agents: all events whose request_id starts with the same `<id>`.

The agents keep one request_id through delegation, execution, energy saving (`<id>/<room>` per
room) and automation rules (spec/ambient-a2a.md), so the part before the first `/` names a flow.
"""

from __future__ import annotations

from typing import Any

from pydantic import AwareDatetime, BaseModel, Field

from collector.events import Action

StoredEvent = dict[str, Any]  # {"id": int, "flow"?: str, **event as the agent logged it}


def flow_of(request_id: str | None) -> str | None:
    return request_id.split("/", 1)[0] if request_id else None


class Flow(BaseModel):
    """Summary of one request for dashboards; GET /flows/{flow} has its events."""

    flow: str
    first_id: int
    last_id: int
    started_at: AwareDatetime
    ended_at: AwareDatetime
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
    """`events` are one flow's events, oldest first."""
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
        first_id=events[0]["id"],
        last_id=events[-1]["id"],
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
