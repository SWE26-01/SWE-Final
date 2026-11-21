"""What an A2A v1.0 Agent Card says about a smart-home agent, read from standard fields only.

The cards carry no extension. An agent tells its role, space, owned devices and shared context
fields through the standard `skills[].tags` (agents/ambient-a2a-plugin/src/a2a.ts `agentCard`):
`room` | `home` | `external`, `space:<id>`, `device:<entity id>`, `field:<name>`.
A plain A2A agent without these tags reads as role None with nothing owned or shared.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

ROLES = ("room", "home", "external")


@dataclass(frozen=True)
class CardTags:
    role: str | None = None
    space: str | None = None
    owned_devices: list[str] = field(default_factory=list)
    provided_fields: list[str] = field(default_factory=list)


def card_tags(card: dict[str, Any]) -> CardTags:
    tags: list[str] = []
    for skill in card.get("skills") or []:
        if isinstance(skill, dict) and isinstance(skill.get("tags"), list):
            tags += [t for t in skill["tags"] if isinstance(t, str) and t not in tags]

    def after(prefix: str) -> list[str]:
        return [t.removeprefix(prefix) for t in tags if t.startswith(prefix) and t != prefix]

    spaces = after("space:")
    return CardTags(
        role=next((r for r in ROLES if r in tags), None),
        space=spaces[0] if spaces else None,
        owned_devices=after("device:"),
        provided_fields=after("field:"),
    )
