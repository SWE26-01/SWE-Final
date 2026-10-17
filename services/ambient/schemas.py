"""Ambient-A2A message schemas (plan doc section 4).

Numbers that identify or order things (sequence, ttl) travel as strings,
because A2A metadata/DataPart values pass through protobuf Struct and
integers come back as floats.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, TypeAdapter

Digits = Annotated[str, Field(pattern=r"^\d+$")]


class ReasonCode(StrEnum):
    ENERGY_SAVING = "ENERGY_SAVING"
    MEETING_MODE = "MEETING_MODE"
    AUTOMATION = "AUTOMATION"
    USER_REQUEST = "USER_REQUEST"
    SAFETY_POLICY = "SAFETY_POLICY"
    OCCUPIED = "OCCUPIED"
    NOT_OWNER = "NOT_OWNER"
    NOT_ALLOWED = "NOT_ALLOWED"
    EXPIRED_CONTEXT = "EXPIRED_CONTEXT"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"


class Presence(StrEnum):
    HOME = "HOME"
    AWAY = "AWAY"


class PcState(StrEnum):
    ACTIVE = "ACTIVE"
    IDLE = "IDLE"
    OFF = "OFF"


# Shared state field names (plan doc 4.1). Add new fields here first.
CONTEXT_FIELDS: frozenset[str] = frozenset(
    {
        "meeting_app_active",  # Desktop: bool
        "meeting_start_at",  # Desktop: ISO 8601 or null
        "pc_state",  # Desktop: PcState
        "presence",  # Mobile: Presence
        "moving",  # Mobile: bool
        "occupied",  # Room: bool
        "temperature",  # Room: str (°C)
        "illuminance",  # Room: str (lux)
    }
)


class _Msg(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ContextUpdate(_Msg):
    type: Literal["context.update"] = "context.update"
    source: str
    subject: str
    sequence: Digits
    expires_at: AwareDatetime
    data: dict[str, Any]

    @property
    def seq(self) -> int:
        return int(self.sequence)

    def is_expired(self, now: datetime) -> bool:
        return now >= self.expires_at


class ContextSubscribe(_Msg):
    type: Literal["context.subscribe"] = "context.subscribe"
    requester: str
    subject: str
    fields: list[str] = Field(min_length=1)
    ttl_seconds: Digits = "3600"

    def expires_at(self, now: datetime) -> datetime:
        return now + timedelta(seconds=int(self.ttl_seconds))


class ContextUnsubscribe(_Msg):
    type: Literal["context.unsubscribe"] = "context.unsubscribe"
    requester: str
    subject: str


class SubscribeResult(_Msg):
    type: Literal["context.subscribe.result"] = "context.subscribe.result"
    subject: str
    accepted_fields: list[str]
    rejected_fields: list[str]
    expires_at: AwareDatetime


class DeviceAction(_Msg):
    device: str
    command: str
    params: dict[str, Any] = Field(default_factory=dict)


class DeviceControl(_Msg):
    type: Literal["device.control"] = "device.control"
    request_id: str
    requester: str
    target: str
    action: DeviceAction
    reason_code: ReasonCode


class ControlResult(_Msg):
    type: Literal["device.control.result"] = "device.control.result"
    request_id: str
    accepted: bool
    reason_code: ReasonCode
    message: str = ""


AmbientMessage = Annotated[
    ContextUpdate
    | ContextSubscribe
    | ContextUnsubscribe
    | SubscribeResult
    | DeviceControl
    | ControlResult,
    Field(discriminator="type"),
]

AMBIENT_MESSAGE_ADAPTER: TypeAdapter[AmbientMessage] = TypeAdapter(AmbientMessage)


def parse_message(data: Any) -> AmbientMessage:
    """Parse a dict (e.g. a DataPart payload) into the matching message model."""
    return AMBIENT_MESSAGE_ADAPTER.validate_python(data)
