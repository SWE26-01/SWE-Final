"""Pack/unpack Ambient-A2A messages into A2A v1.0 DataParts."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from a2a.helpers.proto_helpers import get_data_parts, new_data_part
from a2a.types.a2a_pb2 import Message, Part, Role
from pydantic import BaseModel, ValidationError

from ambient.schemas import AmbientMessage, parse_message

AMBIENT_EXT_URI = "https://github.com/SWE26-01/a2a-agentic-home/blob/main/docs/ambient-a2a-spec.md#v1"
MEDIA_TYPE = "application/json"


def to_part(msg: BaseModel) -> Part:
    return new_data_part(msg.model_dump(mode="json"), media_type=MEDIA_TYPE)


def to_message(msg: BaseModel, role: Role = Role.ROLE_USER) -> Message:
    return Message(message_id=str(uuid.uuid4()), role=role, parts=[to_part(msg)])


def from_parts(parts: Sequence[Part]) -> AmbientMessage | None:
    """First DataPart that parses as an Ambient message, or None."""
    for data in get_data_parts(parts):
        try:
            return parse_message(data)
        except ValidationError:
            continue
    return None
