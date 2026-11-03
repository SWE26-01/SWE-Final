"""Typed models for config/agents.yaml and config/devices.yaml."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

# Home Assistant entity id, e.g. input_boolean.living_light
EntityId = Annotated[str, Field(pattern=r"^[a-z_]+\.[a-z0-9_]+$")]
CallerId = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]*$", max_length=64)]


class _Cfg(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- agents.yaml --------------------------------------------------------------


class Role(StrEnum):
    AGENT = "agent"  # commands the devices it owns, reports events
    OPERATOR = "operator"  # dashboards: read, command nothing


class CallerEntry(_Cfg):
    token_env: Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]*$")]
    url: str | None = None  # A2A base URL; the Agent Card is at <url>/.well-known/agent-card.json


class AgentsFile(_Cfg):
    agents: dict[CallerId, CallerEntry]
    operators: dict[CallerId, CallerEntry] = Field(default_factory=dict)


class Caller(_Cfg):
    id: str
    role: Role
    token: str
    url: str | None = None


# --- devices.yaml -------------------------------------------------------------


class Device(_Cfg):
    entity: EntityId
    space: str
    owner: str

    @property
    def domain(self) -> str:
        return self.entity.split(".", 1)[0]


class DevicesFile(_Cfg):
    spaces: list[str] = Field(min_length=1)
    devices: list[Device]

