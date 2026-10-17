"""Event Collector record: what an agent did, never what it knows (WBS W8-4)."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, get_args

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from ambient.schemas import AmbientMessage, ReasonCode

AgentId = Annotated[str, Field(min_length=1, max_length=64)]

# Every Ambient-A2A `type` value, taken from ambient/schemas.py so new messages are picked up.
MESSAGE_TYPES: tuple[str, ...] = tuple(
    m.model_fields["type"].default for m in get_args(get_args(AmbientMessage)[0])
)
MessageType = Literal[MESSAGE_TYPES]  # type: ignore[valid-type]


class EventKind(StrEnum):
    A2A_SENT = "a2a.sent"
    A2A_RECEIVED = "a2a.received"
    POLICY_DECISION = "policy.decision"
    AUTOMATION_FIRED = "automation.fired"


class AgentEvent(BaseModel):
    """One audit-log entry reported by an agent.

    Only IDs, message types and outcomes are recorded. There is deliberately no free-form data
    field, and `summary` must not contain raw personal data (calendar titles, GPS coordinates).
    """

    model_config = ConfigDict(extra="forbid")

    at: AwareDatetime
    agent: AgentId = Field(description="reporting agent id; must match the caller's token")
    kind: EventKind
    peer: AgentId | None = Field(default=None, description="other agent of an A2A exchange")
    message_type: MessageType | None = None
    request_id: Annotated[str, Field(max_length=64)] | None = None
    task_state: Annotated[str, Field(pattern=r"^TASK_STATE_[A-Z_]+$")] | None = None
    accepted: bool | None = None
    reason_code: ReasonCode | None = None
    summary: str = Field(default="", max_length=200)

    @model_validator(mode="after")
    def _a2a_needs_peer(self) -> AgentEvent:
        a2a = self.kind in (EventKind.A2A_SENT, EventKind.A2A_RECEIVED)
        if a2a and (self.peer is None or self.message_type is None):
            raise ValueError(f"{self.kind} events need `peer` and `message_type`")
        return self
