"""Typed models for config/agents.yaml, config/devices.yaml and config/scenarios.yaml."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

# Home Assistant entity id, e.g. input_boolean.room1_light
EntityId = Annotated[str, Field(pattern=r"^[a-z_]+\.[a-z0-9_]+$")]
CallerId = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]*$", max_length=64)]

SAY_LIMIT = 500  # characters of one thing said to an agent (scenario step or free text)


class _Cfg(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- agents.yaml --------------------------------------------------------------


class Role(StrEnum):
    AGENT = "agent"  # an agent in ../agents: commands the devices it owns, reports events
    OPERATOR = "operator"  # dashboards (the frontend's read-only token): read, command nothing
    SIMULATOR = "simulator"  # Live Simulation: talks to agents through the Runner, commands nothing


class CallerEntry(_Cfg):
    token_env: Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]*$")]
    url: str | None = None  # A2A base URL; the Agent Card is at <url>/.well-known/agent-card.json


class AgentsFile(_Cfg):
    agents: dict[CallerId, CallerEntry]
    operators: dict[CallerId, CallerEntry] = Field(default_factory=dict)
    simulators: dict[CallerId, CallerEntry] = Field(default_factory=dict)


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


# --- scenarios.yaml -----------------------------------------------------------


class Step(_Cfg):
    agent: CallerId = Field(description="agent the Runner talks to")
    say: Annotated[str, Field(min_length=1, max_length=SAY_LIMIT)] = Field(
        description="what the user says to that agent, as in a chat"
    )
    setup: bool = Field(
        default=False, description="prepares the home for the scenario (said to the device owner)"
    )


class Scenario(_Cfg):
    id: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]*$", max_length=64)]
    title: Annotated[str, Field(min_length=1, max_length=64)]
    description: str = ""
    steps: list[Step] = Field(min_length=1)
    expect: dict[EntityId, str] = Field(
        default_factory=dict,
        description="device states expected afterwards, for dashboards to compare; not enforced",
    )


class ScenariosFile(_Cfg):
    scenarios: list[Scenario] = Field(default_factory=list)
