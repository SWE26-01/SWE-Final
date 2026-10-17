"""Typed models for config/devices.yaml, agents.yaml and policies.yaml."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from ambient.schemas import ReasonCode

# Room-local state an agent can read from its own space (Gateway sensors + room mode).
SPACE_FIELDS: frozenset[str] = frozenset({"occupied", "temperature", "illuminance", "sleeping"})


class _Cfg(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- devices.yaml -------------------------------------------------------------


class SpaceType(StrEnum):
    PERSONAL = "personal"
    BABY = "baby"
    ELDERLY = "elderly"
    SHARED = "shared"


class Space(_Cfg):
    id: str
    type: SpaceType


class Device(_Cfg):
    id: str
    space: str
    kind: str
    owner: str
    state: dict[str, str] = Field(default_factory=dict)


class DevicesFile(_Cfg):
    spaces: list[Space]
    devices: list[Device]


# --- agents.yaml --------------------------------------------------------------


class AgentRole(StrEnum):
    AGENT = "agent"
    OPERATOR = "operator"  # dashboard: reads everything, commands nothing


class AgentKind(StrEnum):
    """Selects the implementation package: agents/<kind>/."""

    DESKTOP = "desktop"
    MOBILE = "mobile"
    ROOM = "room"
    HOME = "home"


class SubscribeSpec(_Cfg):
    to: str
    fields: list[str] = Field(min_length=1)


class Agent(_Cfg):
    id: str
    token: str
    role: AgentRole = AgentRole.AGENT
    kind: AgentKind | None = None
    enabled: bool = True
    url: str | None = None
    subject: str | None = None  # user this provider reports on (Desktop, Mobile)
    provides: list[str] = Field(default_factory=list)
    space: str | None = None  # Room agent
    spaces: list[str] = Field(default_factory=list)  # Home agent
    subscribe: list[SubscribeSpec] = Field(default_factory=list)

    @property
    def owned_spaces(self) -> list[str]:
        return [self.space, *self.spaces] if self.space else list(self.spaces)

    @model_validator(mode="after")
    def _agents_need_url_and_kind(self) -> Agent:
        if self.role is AgentRole.AGENT and (self.url is None or self.kind is None):
            raise ValueError(f"agent {self.id!r} needs a url and a kind")
        return self


class AgentsFile(_Cfg):
    agents: list[Agent]


# --- policies.yaml ------------------------------------------------------------


class Condition(_Cfg):
    """Leaf: exactly one of `source` (shared context) or `space` (room state), plus field/equals.
    Composite: `all` or `any` of nested conditions."""

    source: str | None = None
    space: str | None = None
    field: str | None = None
    equals: Any = None
    all: list[Condition] | None = None
    any: list[Condition] | None = None

    @model_validator(mode="after")
    def _shape(self) -> Condition:
        composite = (self.all is not None) + (self.any is not None)
        leaf = (self.source is not None) + (self.space is not None)
        if composite == 1 and leaf == 0 and self.field is None:
            return self
        if composite == 0 and leaf == 1 and self.field is not None:
            return self
        raise ValueError("condition must be {source|space, field, equals} or {all|any: [...]}")

    def leaves(self) -> list[Condition]:
        nested = self.all or self.any
        if nested is None:
            return [self]
        return [leaf for c in nested for leaf in c.leaves()]


class Action(_Cfg):
    """Command an owned device directly, or `request` the owner agent to do it."""

    device: str
    command: str
    params: dict[str, Any] = Field(default_factory=dict)
    request: str | None = None


class AutomationRule(_Cfg):
    when: Condition
    then: list[Action] = Field(min_length=1)


class RequestRule(_Cfg):
    """How an owner answers `device.control` for one of its devices.

    `allow` limits which commands are accepted (all if omitted); `from_` limits requesters;
    `deny_if` rejects with `reason` when the condition holds."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    device: str
    command: str | None = None
    from_: str | None = Field(default=None, alias="from")
    allow: list[str] | None = None
    deny_if: Condition | None = None
    reason: ReasonCode | None = None

    @model_validator(mode="after")
    def _deny_needs_reason(self) -> RequestRule:
        if self.deny_if is not None and self.reason is None:
            raise ValueError(f"request rule for {self.device!r} has deny_if but no reason")
        return self


class AgentPolicy(_Cfg):
    automation: list[AutomationRule] = Field(default_factory=list)
    requests: list[RequestRule] = Field(default_factory=list)


class PoliciesFile(_Cfg):
    # provider id -> requester id -> fields the requester may read
    disclosure: dict[str, dict[str, list[str]]] = Field(default_factory=dict)
    agents: dict[str, AgentPolicy] = Field(default_factory=dict)
