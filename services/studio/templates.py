"""Agent templates: the fixed skeleton of every agent Studio makes. The LLM fills slots; the rest of
the agent (tools, paths, guide text) is written here once and reviewed like any code."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

HOME_AGENT_ID = "orchestrator"  # the Home Agent (agents/shared.json5); it delegates room devices

# Plain words for the user-facing summary and the offline filler.
KIND_NAMES = {
    "light": "조명",
    "light_mode": "조명 모드",
    "ac": "에어컨",
    "tv": "TV",
    "tv_muted": "TV 음소거",
    "occupancy": "재실 센서",
    "sleep_mode": "수면 모드",
    "temperature": "온도 센서",
}
SPACE_NAMES = {"living_room": "거실", "my_room": "내 방", "protected_room": "보호 방"}


def _guide(name: str) -> str:
    """studio/guides/<name>.md: the agent's guide, with {slots} for render.py."""
    return (Path(__file__).parent / "guides" / f"{name}.md").read_text(encoding="utf-8")


@dataclass(frozen=True)
class Template:
    id: str
    name: str
    description: str
    role: str  # Ambient-A2A role in the plugin config
    agents_md: str  # the agent's guide (OpenClaw AGENTS.md) with {slots} for render.py


ROOM_AGENT = Template(
    id="room_agent",
    name="Room agent",
    description=(
        "Owns the devices of one room and runs the chosen skills. The Home Agent asks it for "
        "changes; its own policies decide."
    ),
    role="room",
    agents_md=_guide("room_agent"),
)

TEMPLATES = {t.id: t for t in [ROOM_AGENT]}
