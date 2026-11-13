"""Typed models for config/agents.yaml, devices.yaml, scenarios.yaml and skills.yaml."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# Home Assistant entity id, e.g. input_boolean.room1_light
EntityId = Annotated[str, Field(pattern=r"^[a-z_]+\.[a-z0-9_]+$")]
CallerId = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]*$", max_length=64)]
# What a device is, independent of the room: light, light_mode, ac, tv, sleep_mode ...
DeviceKind = Annotated[str, Field(pattern=r"^[a-z][a-z_]*$", max_length=32)]
# Ambient-A2A context field shared by an external agent, e.g. meeting_app_active
FieldName = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=64)]

SAY_LIMIT = 500  # characters of one thing said to an agent (scenario step or free text)
# What is said to an agent: trimmed, never blank (a blank message would still cost an LLM turn).
Say = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=SAY_LIMIT)]


class _Cfg(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- agents.yaml --------------------------------------------------------------


class Role(StrEnum):
    AGENT = "agent"  # an agent in ../agents: commands the devices it owns, reports events
    OPERATOR = "operator"  # dashboards (the frontend's read-only token): read, command nothing
    SIMULATOR = "simulator"  # Live Simulation: talks to agents through the Runner, commands nothing
    USER = "user"  # the home user on the Studio and Hub screens: creates and connects agents
    SERVICE = "service"  # a backend calling another one (Studio registers agents in the Hub)


class CallerEntry(_Cfg):
    token_env: Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9_]*$")]
    url: str | None = None  # A2A base URL; the Agent Card is at <url>/.well-known/agent-card.json


class AgentsFile(_Cfg):
    agents: dict[CallerId, CallerEntry]
    operators: dict[CallerId, CallerEntry] = Field(default_factory=dict)
    simulators: dict[CallerId, CallerEntry] = Field(default_factory=dict)
    users: dict[CallerId, CallerEntry] = Field(default_factory=dict)
    services: dict[CallerId, CallerEntry] = Field(default_factory=dict)


class Caller(_Cfg):
    id: str
    role: Role
    token: str
    url: str | None = None
    token_env: str | None = None  # the environment variable the token came from


# --- devices.yaml -------------------------------------------------------------


class Device(_Cfg):
    entity: EntityId
    space: str
    owner: str
    kind: DeviceKind | None = None  # what skills (skills.yaml) refer to

    @property
    def domain(self) -> str:
        return self.entity.split(".", 1)[0]


class DevicesFile(_Cfg):
    spaces: list[str] = Field(min_length=1)
    devices: list[Device]


# --- scenarios.yaml -----------------------------------------------------------


class Step(_Cfg):
    agent: CallerId = Field(description="agent the Runner talks to")
    say: Say = Field(description="what the user says to that agent, as in a chat")
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


# --- skills.yaml (Skill Marketplace) ------------------------------------------
#
# A skill names device kinds, never entity ids, so one skill fits any room that has those kinds.
# Studio turns the chosen skills into the generated agent's rules, policies and energy saving for
# the devices of one space (studio/compile.py). The LLM only picks skills; it never writes rules.

Command = Literal["TURN_ON", "TURN_OFF", "SET"]


class SkillAction(_Cfg):
    kind: DeviceKind
    command: Command
    value: str | None = None  # SET only


class SkillRule(_Cfg):
    field: FieldName = Field(description="context field from a subscribed agent")
    equals: bool | str
    actions: list[SkillAction] = Field(min_length=1)


class SkillCondition(_Cfg):
    kind: DeviceKind
    state: str


class SkillDeny(_Cfg):
    kinds: list[DeviceKind] = Field(min_length=1)
    commands: list[Command] = Field(min_length=1)


class SkillPolicy(_Cfg):
    when: SkillCondition
    deny: SkillDeny
    reason_code: Annotated[str, Field(pattern=r"^[A-Z][A-Z_]*$")] = "SAFETY_POLICY"
    message: str


class Skill(_Cfg):
    id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=40)]
    name: Annotated[str, Field(min_length=1, max_length=40)]
    description: Annotated[str, Field(min_length=1, max_length=200)]
    category: Literal["context", "safety", "energy", "monitoring"]
    templates: list[str] = Field(min_length=1, description="Studio templates it can be added to")
    needs_all: list[DeviceKind] = Field(default_factory=list)
    needs_any: list[DeviceKind] = Field(default_factory=list)
    subscribes: dict[CallerId, list[FieldName]] = Field(default_factory=dict)
    rules: list[SkillRule] = Field(default_factory=list)
    policies: list[SkillPolicy] = Field(default_factory=list)
    energy_saving: list[SkillAction] = Field(default_factory=list)
    keywords: list[str] = Field(
        default_factory=list, description="words Studio's offline filler matches (no LLM)"
    )

    def kinds(self) -> set[str]:
        """Device kinds this skill acts on or reads."""
        found = {a.kind for r in self.rules for a in r.actions}
        found |= {k for p in self.policies for k in [p.when.kind, *p.deny.kinds]}
        found |= {a.kind for a in self.energy_saving}
        return found | set(self.needs_all) | set(self.needs_any)


class SkillsFile(_Cfg):
    skills: list[Skill] = Field(default_factory=list)


class CatalogSkill(Skill):
    """A Marketplace entry as the Hub and Studio list it."""

    available_spaces: list[str] = Field(
        description="spaces whose devices meet the skill's needs (empty: no room can run it)"
    )
