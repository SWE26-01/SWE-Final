"""Load and cross-check config/*.yaml plus the secrets they name in the environment.

Every service (Gateway, Event Collector, Runner, Agent Hub, Studio) reads configuration only through
`load_config()`.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar
from urllib.parse import urlsplit, urlunsplit

import yaml
from pydantic import BaseModel, ValidationError

from homeconfig.models import (
    AgentsFile,
    Caller,
    CatalogSkill,
    Device,
    DevicesFile,
    Role,
    Scenario,
    ScenariosFile,
    Skill,
    SkillsFile,
)

DEFAULT_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
DEFAULT_HA_URL = "http://127.0.0.1:8123"

M = TypeVar("M", bound=BaseModel)


class ConfigError(Exception):
    """Raised with every problem found, one per line."""

    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__("invalid config:\n- " + "\n- ".join(problems))


@dataclass(frozen=True)
class HomeConfig:
    callers: dict[str, Caller]
    devices: dict[str, Device]  # entity id -> device
    spaces: list[str]
    ha_url: str  # the real Home Assistant (env HA_URL)
    ha_token: str | None  # env HA_TOKEN; only the Gateway needs it
    openclaw_token: str | None = field(repr=False)  # env OPENCLAW_GATEWAY_TOKEN; only the Runner
    scenarios: dict[str, Scenario]  # scenario id -> scenario (config/scenarios.yaml, optional)
    skills: dict[str, Skill]  # skill id -> skill (config/skills.yaml, optional): the marketplace
    cors_origins: list[str]  # env AMBIENT_CORS_ORIGINS: browser origins allowed to read directly
    # Problems with optional callers (simulators, users, services). They never stop the Gateway or
    # the Collector; the Runner, the Hub and Studio report them.
    optional_problems: list[str]
    _by_token: dict[str, str] = field(repr=False)

    def caller_by_token(self, token: str) -> Caller | None:
        caller_id = self._by_token.get(token)
        return None if caller_id is None else self.callers[caller_id]

    def agents(self) -> list[Caller]:
        return [c for c in self.callers.values() if c.role is Role.AGENT]

    def owner_of(self, entity: str) -> str | None:
        device = self.devices.get(entity)
        return None if device is None else device.owner

    def owned_by(self, agent_id: str) -> list[str]:
        return [d.entity for d in self.devices.values() if d.owner == agent_id]

    def devices_in(self, space: str) -> list[Device]:
        return [d for d in self.devices.values() if d.space == space]

    def spaces_for(self, skill: Skill) -> list[str]:
        """Spaces whose devices meet the skill's `needs_all` and `needs_any`."""
        found = []
        for space in self.spaces:
            kinds = {d.kind for d in self.devices_in(space) if d.kind}
            if set(skill.needs_all) <= kinds and (
                not skill.needs_any or kinds & set(skill.needs_any)
            ):
                found.append(space)
        return found

    def search_skills(
        self,
        q: str | None = None,
        category: str | None = None,
        template: str | None = None,
        space: str | None = None,
    ) -> list[CatalogSkill]:
        """The Marketplace search: text in id, name, description or keywords; category; template;
        and `space` keeps only skills that space can run."""
        found = []
        for skill in self.skills.values():
            text = " ".join([skill.id, skill.name, skill.description, *skill.keywords]).lower()
            spaces = self.spaces_for(skill)
            if q and q.strip().lower() not in text:
                continue
            if (category and skill.category != category) or (
                template and template not in skill.templates
            ):
                continue
            if space and space not in spaces:
                continue
            found.append(CatalogSkill(**skill.model_dump(), available_spaces=spaces))
        return found


def _on_host(url: str | None, host: str | None) -> str | None:
    """Point a loopback agent URL at `host` (env AMBIENT_AGENTS_HOST). A service in Docker reaches
    agents running on the machine through e.g. host.docker.internal, not 127.0.0.1."""
    if not url or not host:
        return url
    parts = urlsplit(url)
    if parts.hostname not in ("127.0.0.1", "localhost"):
        return url
    netloc = f"{host}:{parts.port}" if parts.port else host
    return urlunsplit(parts._replace(netloc=netloc))


def _read(path: Path, model: type[M], problems: list[str]) -> M | None:
    try:
        raw = yaml.safe_load(path.read_text()) or {}
    except (OSError, yaml.YAMLError) as e:
        problems.append(f"{path.name}: {e}")
        return None
    try:
        return model.model_validate(raw)
    except ValidationError as e:
        for err in e.errors():
            loc = ".".join(str(p) for p in err["loc"])
            problems.append(f"{path.name}: {loc}: {err['msg']}")
        return None


_ARTICLE = {
    Role.AGENT: "an agent",
    Role.OPERATOR: "an operator",
    Role.SIMULATOR: "a simulator",
    Role.USER: "a user",
    Role.SERVICE: "a service",
}
# Without their token only one feature stays off (Live Simulation, Studio/Hub writes).
_OPTIONAL = {Role.SIMULATOR, Role.USER, Role.SERVICE}


def load_config(
    config_dir: Path | str | None = None, env: Mapping[str, str] | None = None
) -> HomeConfig:
    """Read agents.yaml, devices.yaml and (if present) scenarios.yaml and skills.yaml from
    `config_dir`, resolve tokens from `env` (default: the process environment) and check everything.
    Raises ConfigError."""
    base = Path(config_dir) if config_dir is not None else DEFAULT_CONFIG_DIR
    env = os.environ if env is None else env
    problems: list[str] = []
    agents_f = _read(base / "agents.yaml", AgentsFile, problems)
    devices_f = _read(base / "devices.yaml", DevicesFile, problems)
    scenarios_path = base / "scenarios.yaml"
    scenarios_f = (
        _read(scenarios_path, ScenariosFile, problems)
        if scenarios_path.exists()
        else ScenariosFile()
    )
    skills_path = base / "skills.yaml"
    skills_f = _read(skills_path, SkillsFile, problems) if skills_path.exists() else SkillsFile()
    if agents_f is None or devices_f is None or scenarios_f is None or skills_f is None:
        raise ConfigError(problems)

    callers: dict[str, Caller] = {}
    roles: dict[str, Role] = {}
    by_token: dict[str, str] = {}
    optional_problems: list[str] = []
    entries = [(Role.AGENT, i, e) for i, e in agents_f.agents.items()]
    entries += [(Role.OPERATOR, i, e) for i, e in agents_f.operators.items()]
    entries += [(Role.SIMULATOR, i, e) for i, e in agents_f.simulators.items()]
    entries += [(Role.USER, i, e) for i, e in agents_f.users.items()]
    entries += [(Role.SERVICE, i, e) for i, e in agents_f.services.items()]
    for role, caller_id, entry in entries:
        if caller_id in roles:
            first = _ARTICLE[roles[caller_id]]
            problems.append(f"{caller_id!r} is listed as both {first} and {_ARTICLE[role]}")
            continue
        roles[caller_id] = role
        # Optional roles: without a usable token only their feature stays off.
        found = optional_problems if role in _OPTIONAL else problems
        token = env.get(entry.token_env, "")
        if not token:
            found.append(f"{caller_id}: environment variable {entry.token_env} is not set")
            continue
        if token in by_token:
            found.append(f"{caller_id}: same token as {by_token[token]!r}")
            continue
        url = _on_host(entry.url, env.get("AMBIENT_AGENTS_HOST") or None)
        callers[caller_id] = Caller(
            id=caller_id, role=role, token=token, url=url, token_env=entry.token_env
        )
        by_token[token] = caller_id

    devices: dict[str, Device] = {}
    for d in devices_f.devices:
        if d.entity in devices:
            problems.append(f"duplicate device {d.entity!r}")
        if d.space not in devices_f.spaces:
            problems.append(f"device {d.entity!r}: unknown space {d.space!r}")
        if d.owner not in agents_f.agents:
            problems.append(f"device {d.entity!r}: owner {d.owner!r} is not an agent")
        devices[d.entity] = d

    scenarios: dict[str, Scenario] = {}
    for s in scenarios_f.scenarios:
        if s.id in scenarios:
            problems.append(f"duplicate scenario {s.id!r}")
        for step in s.steps:
            if step.agent not in agents_f.agents:
                problems.append(f"scenario {s.id!r}: {step.agent!r} is not an agent")
        for entity in s.expect:
            if entity not in devices:
                problems.append(f"scenario {s.id!r}: expects unknown device {entity!r}")
        scenarios[s.id] = s

    skills: dict[str, Skill] = {}
    for s in skills_f.skills:
        if s.id in skills:
            problems.append(f"duplicate skill {s.id!r}")
        for peer in s.subscribes:
            if peer not in agents_f.agents:
                problems.append(f"skill {s.id!r}: subscribes to {peer!r}, which is not an agent")
        skills[s.id] = s

    cors_origins = [o.strip() for o in env.get("AMBIENT_CORS_ORIGINS", "").split(",") if o.strip()]
    for origin in cors_origins:
        if not re.fullmatch(r"https?://[^/\s]+", origin):
            problems.append(
                f"AMBIENT_CORS_ORIGINS: {origin!r} is not an origin like http://localhost:5173"
            )

    if problems:
        raise ConfigError(problems)
    return HomeConfig(
        callers=callers,
        devices=devices,
        spaces=list(devices_f.spaces),
        ha_url=(env.get("HA_URL") or DEFAULT_HA_URL).rstrip("/"),
        ha_token=env.get("HA_TOKEN") or None,
        openclaw_token=env.get("OPENCLAW_GATEWAY_TOKEN") or None,
        scenarios=scenarios,
        skills=skills,
        cors_origins=cors_origins,
        optional_problems=optional_problems,
        _by_token=by_token,
    )
