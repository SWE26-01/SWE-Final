"""Agent templates: the fixed skeleton of every agent Studio makes. The LLM fills slots; the rest of
the agent (tools, paths, guide text) is written here once and reviewed like any code."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

HOME_AGENT_ID = "root"  # the Home Agent (agents/shared.json5); it delegates room devices

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
    "coffee_machine": "커피머신",
    "beans_low": "원두 부족 센서",
}
SPACE_NAMES = {
    "living_room": "거실",
    "my_room": "내 방",
    "protected_room": "보호 방",
    "kitchen": "주방",
}


def _guide(name: str) -> str:
    """studio/guides/<name>.md: the agent's guide, with {slots} for render.py."""
    return (Path(__file__).parent / "guides" / f"{name}.md").read_text(encoding="utf-8")


@dataclass(frozen=True)
class Template:
    id: str
    name: str
    description: str
    role: str  # role in the plugin config (room, home, external)
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

ASSISTANT_AGENT = Template(
    id="assistant_agent",
    name="Assistant agent",
    description=(
        "A conversational helper for anything that is not controlling this home's devices: "
        "coaching, explaining, planning, studying, recipes, habits. People chat with it from the "
        "Hub. It owns no device and has no shell, file or web tools; it answers from its own "
        "knowledge, following the instructions written for it."
    ),
    role="external",
    agents_md=_guide("assistant_agent"),
)

ROUTINE_AGENT = Template(
    id="routine_agent",
    name="Routine agent",
    description=(
        "Does something at a time of day, every day (e.g. brew coffee at 07:30). It owns no "
        "device: at that time it asks the Root Agent, which passes the request to the device's "
        "owner, whose policies decide. Choose the space, the device kinds, the command and the "
        "time `at` (HH:MM)."
    ),
    role="external",
    agents_md=_guide("routine_agent"),
)

TEMPLATES = {t.id: t for t in [ROOM_AGENT, ASSISTANT_AGENT, ROUTINE_AGENT]}
# Run inside the launcher (scripts/launcher.mjs) instead of an OpenClaw gateway of their own: they
# need no device plugin, only an LLM call (OpenRouter) and, for routines, a clock and one A2A call.
LIGHT_TEMPLATES = {ASSISTANT_AGENT.id, ROUTINE_AGENT.id}
