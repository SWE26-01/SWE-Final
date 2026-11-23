"""Where a generated agent runs. Studio compiles a request into a runtime-neutral AgentSpec; the
runtime turns that spec into its own files and locks them (harness). Drafts, the AgentSpec and the
Hub do not depend on the runtime, so it can be swapped.

Today there is one runtime: OpenClaw (a profile like ../agents/internal/*). To run generated
agents on a Python runtime instead, add a class with the same members to RUNTIMES and set
STUDIO_RUNTIME to its name; nothing else in Studio or the Hub changes.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Protocol

from homeconfig import HomeConfig
from studio.compile import AgentSpec
from studio.harness import PORT_RANGE, check_light, check_rendered
from studio.render import render, render_light
from studio.templates import LIGHT_TEMPLATES

LAUNCHER_URL = "http://127.0.0.1:18700/agents"  # light agents' A2A base (scripts/launcher.mjs)


class Runtime(Protocol):
    name: str
    ports: range  # ports Studio may give generated agents, with their step

    def build(self, spec: AgentSpec, port: int, draft_id: str) -> tuple[dict[str, str], list[str]]:
        """(files for agents/generated/<agent_id>/, capability-lock problems). Studio writes the
        files only when there are no problems and the user approved."""
        ...

    def url(self, spec: AgentSpec, port: int) -> str:
        """The agent's A2A base URL, registered in the Hub (its Agent Card is under it)."""
        ...


class OpenClawRuntime:
    name = "openclaw"
    # OpenClaw gateways sit 120 ports apart, like the platform agents (scripts/run_all.sh).
    ports = range(PORT_RANGE.start, PORT_RANGE.stop, 120)

    def __init__(self, config: HomeConfig) -> None:
        self._config = config

    def build(self, spec: AgentSpec, port: int, draft_id: str) -> tuple[dict[str, str], list[str]]:
        if spec.template in LIGHT_TEMPLATES:  # no gateway of its own: the launcher runs it
            light, files = render_light(spec, draft_id)
            asked = [
                p.removeprefix("request:") for p in spec.permissions if p.startswith("request:")
            ]
            return files, check_light(light, spec.agent_id, asked, files["AGENTS.md"])
        profile, files = render(spec, port, self._config, draft_id)
        return files, check_rendered(profile, spec.agent_id, spec.owned, files["AGENTS.md"])

    def url(self, spec: AgentSpec, port: int) -> str:
        if spec.template in LIGHT_TEMPLATES:
            return f"{LAUNCHER_URL}/{spec.agent_id}"
        return f"http://127.0.0.1:{port}/plugins/a2a"


RUNTIMES: dict[str, type[OpenClawRuntime]] = {OpenClawRuntime.name: OpenClawRuntime}


def choose_runtime(config: HomeConfig, env: Mapping[str, str] | None = None) -> Runtime:
    """STUDIO_RUNTIME picks the runtime (default openclaw)."""
    env = os.environ if env is None else env
    name = env.get("STUDIO_RUNTIME") or OpenClawRuntime.name
    if name not in RUNTIMES:
        raise ValueError(f"STUDIO_RUNTIME={name!r}: choose one of {', '.join(RUNTIMES)}")
    return RUNTIMES[name](config)
