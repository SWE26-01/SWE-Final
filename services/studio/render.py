"""AgentSpec -> the OpenClaw profile directory (openclaw.json5 + AGENTS.md), in the same shape as
the platform agents in ../agents/internel/*. Fixed parts come from the template and the harness
constants; the spec only fills ids, devices and the plugin's rules."""

from __future__ import annotations

import json
from typing import Any

from homeconfig import HomeConfig
from studio.compile import AgentSpec
from studio.harness import HOME_PLUGIN_PATH, SKILLS, TOOLS
from studio.templates import TEMPLATES

DEFAULT_MODEL = "${AMBIENT_MODEL:-openrouter/anthropic/claude-haiku-5.5}"


def profile_of(spec: AgentSpec, port: int) -> dict[str, Any]:
    plugin: dict[str, Any] = {
        "$include": "../../shared.json5",
        "agentId": spec.agent_id,
        "publicUrl": f"http://127.0.0.1:{port}/plugins/ambient",
        "role": spec.role,
        "space": spec.space,
        "owned": spec.owned,
        "requestAcl": spec.request_acl,
    }
    for key, value in [
        ("subscribeTo", spec.subscribe_to),
        ("rules", spec.rules),
        ("policies", spec.policies),
        ("energySaving", spec.energy_saving),
    ]:
        if value:
            plugin[key] = value
    return {
        "gateway": {"$include": "../../gateway.json5", "port": port},
        "agents": {
            "defaults": {
                "workspace": f"${{AMBIENT_HOME}}/state/{spec.agent_id}/workspace",
                "model": {"primary": DEFAULT_MODEL},
                "thinkingDefault": "off",
                "skipBootstrap": True,
            }
        },
        "tools": dict(TOOLS),
        "skills": dict(SKILLS),
        "plugins": {
            "load": {"paths": [HOME_PLUGIN_PATH]},
            "entries": {"ambient-a2a": {"enabled": True, "config": plugin}},
        },
    }


def render(spec: AgentSpec, port: int, config: HomeConfig, draft_id: str) -> tuple[dict, dict]:
    """(profile, files). Run harness.check_rendered on the profile before writing the files."""
    profile = profile_of(spec, port)
    header = (
        f"// OpenClaw profile {spec.agent_id!r}, made by Studio from draft {draft_id}.\n"
        "// Do not edit by hand: change the request in Studio and approve again.\n"
        f"// Run: scripts/oc.sh {spec.agent_id} gateway\n"
    )
    skills = ", ".join(config.skills[s].name for s in spec.skills) or "(none)"
    guide = TEMPLATES[spec.template].agents_md.format(
        agent_id=spec.agent_id,
        space=spec.space,
        display_name=spec.display_name,
        description=spec.description or "(none)",
        skills=skills,
    )
    files = {
        "openclaw.json5": header + json.dumps(profile, indent=2, ensure_ascii=True) + "\n",
        "AGENTS.md": guide,
    }
    return profile, files
