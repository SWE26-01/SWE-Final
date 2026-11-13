"""The form the LLM fills. Every choice is an enum built from the catalogs (templates, spaces,
device kinds, Marketplace skills), so the LLM cannot name a device, a tool or a rule that does not
exist. The only free text is a short name, a description and a question or reason."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model

from homeconfig import HomeConfig
from studio.templates import TEMPLATES

Outcome = Literal["draft", "clarify", "unsupported"]
Line = Annotated[str, Field(max_length=200)]


def device_kinds(config: HomeConfig) -> list[str]:
    return sorted({d.kind for d in config.devices.values() if d.kind})


def slot_model(config: HomeConfig) -> type[BaseModel]:
    if not config.skills:
        raise ValueError("no skills in config/skills.yaml: Studio has nothing to build agents from")
    templates = Literal[tuple(TEMPLATES)]  # type: ignore[valid-type]
    spaces = Literal[tuple(config.spaces)]  # type: ignore[valid-type]
    skills = Literal[tuple(config.skills)]  # type: ignore[valid-type]
    kinds = Literal[tuple(device_kinds(config))]  # type: ignore[valid-type]
    return create_model(
        "AgentSlots",
        __config__=ConfigDict(extra="forbid"),
        __doc__="Choices for one smart-home agent. Studio's code builds the agent from them.",
        outcome=(
            Outcome,
            Field(description="draft: buildable; clarify: ask the user; unsupported: refuse"),
        ),
        template=(templates | None, Field(default=None, description="agent template id")),
        display_name=(
            Annotated[str, Field(max_length=40)] | None,
            Field(default=None, description="short Korean name for the agent"),
        ),
        description=(
            Line | None,
            Field(default=None, description="one Korean sentence: what the agent does"),
        ),
        space=(spaces | None, Field(default=None, description="the room the agent manages")),
        skills=(
            list[skills],
            Field(default_factory=list, max_length=5, description="Marketplace skill ids"),
        ),
        devices=(
            list[kinds],
            Field(default_factory=list, max_length=10, description="device kinds the user named"),
        ),
        question=(Line | None, Field(default=None, description="Korean question (clarify)")),
        reason=(Line | None, Field(default=None, description="Korean reason (unsupported)")),
    )


class Slots(BaseModel):
    """Static view of `slot_model(...)` instances, for type checkers and tests."""

    model_config = ConfigDict(extra="forbid")
    outcome: Outcome
    template: str | None = None
    display_name: str | None = None
    description: str | None = None
    space: str | None = None
    skills: list[str] = []
    devices: list[str] = []
    question: str | None = None
    reason: str | None = None
