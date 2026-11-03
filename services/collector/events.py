"""Event Collector record: one line of an agent's event log.

Agents POST one JSON object per A2A message, execution and automation rule. Only the fields
below are stored; anything else in the object is dropped, so a new log field can never leak
data into the audit log by accident. Personal data and secrets are never logged.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    model_validator,
)

TEXT_LIMIT = 300

AgentId = Annotated[str, Field(min_length=1, max_length=64)]
Code = Annotated[str, Field(pattern=r"^[A-Z][A-Z_]*$", max_length=40)]
Text = Annotated[str, AfterValidator(lambda s: s[:TEXT_LIMIT])]
Name = Annotated[str, Field(max_length=64)]


class Direction(StrEnum):
    IN = "in"  # a message this agent received and answered
    OUT = "out"  # a message this agent sent
    OUT_RESULT = "out-result"  # the answer to a message it sent
    OUT_ERROR = "out-error"  # sending failed (peer down, timeout)
    EXEC = "exec"  # it ran a command on one of its own devices
    RULE = "rule"  # one of its automation rules fired


class Action(BaseModel):
    """What was asked or done to a device: {device?, command, value?}."""

    model_config = ConfigDict(extra="ignore")

    device: Annotated[str, Field(max_length=128)] | None = None
    command: Name | None = None
    value: StrictBool | int | float | Name | None = None


class AgentEvent(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    ts: AwareDatetime
    agent: AgentId = Field(description="reporting agent; must match the caller's token")
    dir: Direction
    to: AgentId | None = Field(default=None, description="peer of an out* event")
    from_: AgentId | None = Field(
        default=None, alias="from", description="peer of an `in` event ('?' if unknown token)"
    )
    type: Name | None = Field(default=None, description="A2A message type")
    request_id: Annotated[str, Field(max_length=128)] | None = None
    on_behalf_of: AgentId | None = Field(default=None, description="original requester")
    action: Action | None = None
    fields: Annotated[list[Name], Field(max_length=32)] | None = None
    accepted: bool | None = None
    reason_code: Code | None = Field(default=None, description="machine-readable reason, e.g. OK")
    message: Text | None = None
    rule: Text | None = Field(default=None, description="rule events: the field=value that fired")
    error: Text | None = Field(default=None, description="out-error events")

    @model_validator(mode="after")
    def _peer(self) -> AgentEvent:
        if self.dir is Direction.IN and self.from_ is None:
            raise ValueError("`in` events need `from`")
        outgoing = (Direction.OUT, Direction.OUT_RESULT, Direction.OUT_ERROR)
        if self.dir in outgoing and self.to is None:
            raise ValueError(f"`{self.dir}` events need `to`")
        return self

    def stored(self) -> str:
        """JSON as stored and streamed: the agent's own field names, unset fields left out."""
        return self.model_dump_json(by_alias=True, exclude_none=True)
