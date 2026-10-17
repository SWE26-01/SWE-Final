"""Load and cross-check config/*.yaml. Every agent and service reads config through here."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

import yaml
from pydantic import BaseModel, ValidationError

from ambient.schemas import CONTEXT_FIELDS
from homeconfig.models import (
    SPACE_FIELDS,
    Agent,
    AgentPolicy,
    AgentRole,
    AgentsFile,
    Condition,
    Device,
    DevicesFile,
    PoliciesFile,
    Space,
)

DEFAULT_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"

M = TypeVar("M", bound=BaseModel)


class ConfigError(Exception):
    """Raised with every problem found, one per line."""

    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__("invalid config:\n- " + "\n- ".join(problems))


@dataclass(frozen=True)
class HomeConfig:
    spaces: dict[str, Space]
    devices: dict[str, Device]
    agents: dict[str, Agent]
    policies: PoliciesFile
    _by_token: dict[str, str] = field(repr=False)

    def agent(self, agent_id: str) -> Agent:
        return self.agents[agent_id]

    def agent_by_token(self, token: str) -> Agent | None:
        agent_id = self._by_token.get(token)
        return None if agent_id is None else self.agents[agent_id]

    def owner_of(self, device_id: str) -> str:
        return self.devices[device_id].owner

    def devices_owned_by(self, agent_id: str) -> list[Device]:
        return [d for d in self.devices.values() if d.owner == agent_id]

    def allowed_fields(self, provider: str, requester: str) -> list[str]:
        """Fields `requester` may read from `provider`; empty if not listed."""
        return self.policies.disclosure.get(provider, {}).get(requester, [])

    def policy(self, agent_id: str) -> AgentPolicy:
        return self.policies.agents.get(agent_id, AgentPolicy())


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


def _dupes(ids: list[str]) -> set[str]:
    seen: set[str] = set()
    return {i for i in ids if i in seen or seen.add(i)}


def load_config(config_dir: Path | str | None = None) -> HomeConfig:
    """Read devices.yaml, agents.yaml and policies.yaml from `config_dir` and validate them
    against each other. Raises ConfigError listing every problem."""
    base = Path(config_dir) if config_dir is not None else DEFAULT_CONFIG_DIR
    problems: list[str] = []
    devices_f = _read(base / "devices.yaml", DevicesFile, problems)
    agents_f = _read(base / "agents.yaml", AgentsFile, problems)
    policies_f = _read(base / "policies.yaml", PoliciesFile, problems)
    if problems or devices_f is None or agents_f is None or policies_f is None:
        raise ConfigError(problems)

    for name, ids in (
        ("space", [s.id for s in devices_f.spaces]),
        ("device", [d.id for d in devices_f.devices]),
        ("agent", [a.id for a in agents_f.agents]),
        ("token", [a.token for a in agents_f.agents]),
    ):
        for dup in sorted(_dupes(ids)):
            problems.append(f"duplicate {name}: {dup!r}")

    spaces = {s.id: s for s in devices_f.spaces}
    devices = {d.id: d for d in devices_f.devices}
    agents = {a.id: a for a in agents_f.agents}
    _check(spaces, devices, agents, policies_f, problems)
    if problems:
        raise ConfigError(problems)

    return HomeConfig(
        spaces=spaces,
        devices=devices,
        agents=agents,
        policies=policies_f,
        _by_token={a.token: a.id for a in agents_f.agents},
    )


def _check(
    spaces: dict[str, Space],
    devices: dict[str, Device],
    agents: dict[str, Agent],
    policies: PoliciesFile,
    problems: list[str],
) -> None:
    for d in devices.values():
        if d.space not in spaces:
            problems.append(f"device {d.id!r}: unknown space {d.space!r}")
        owner = agents.get(d.owner)
        if owner is None:
            problems.append(f"device {d.id!r}: owner {d.owner!r} is not in agents.yaml")
        elif owner.role is AgentRole.OPERATOR:
            problems.append(f"device {d.id!r}: operator {d.owner!r} cannot own devices")

    for a in agents.values():
        for s in a.owned_spaces:
            if s not in spaces:
                problems.append(f"agent {a.id!r}: unknown space {s!r}")
        for f in a.provides:
            if f not in CONTEXT_FIELDS:
                problems.append(
                    f"agent {a.id!r}: provides unknown field {f!r} (see CONTEXT_FIELDS)"
                )
        for sub in a.subscribe:
            provider = agents.get(sub.to)
            if provider is None:
                problems.append(f"agent {a.id!r}: subscribes to unknown agent {sub.to!r}")
                continue
            allowed = set(policies.disclosure.get(sub.to, {}).get(a.id, []))
            for f in sub.fields:
                if f not in provider.provides:
                    problems.append(f"agent {a.id!r}: {sub.to!r} does not provide {f!r}")
                elif f not in allowed:
                    problems.append(
                        f"agent {a.id!r}: subscribes to {sub.to}.{f} "
                        "but disclosure does not allow it"
                    )

    for provider_id, readers in policies.disclosure.items():
        provider = agents.get(provider_id)
        if provider is None:
            problems.append(f"disclosure: unknown provider {provider_id!r}")
            continue
        for reader_id, fields in readers.items():
            if reader_id not in agents:
                problems.append(f"disclosure.{provider_id}: unknown requester {reader_id!r}")
            for f in fields:
                if f not in provider.provides:
                    problems.append(
                        f"disclosure.{provider_id}: {provider_id!r} does not provide {f!r}"
                    )

    for agent_id, pol in policies.agents.items():
        where = f"policies.{agent_id}"
        if agent_id not in agents:
            problems.append(f"{where}: unknown agent")
            continue
        subscribed = {(sub.to, f) for sub in agents[agent_id].subscribe for f in sub.fields}
        for i, rule in enumerate(pol.automation):
            _check_condition(rule.when, f"{where}.automation[{i}]", agents, spaces, problems)
            for leaf in rule.when.leaves():
                if leaf.source is not None and (leaf.source, leaf.field) not in subscribed:
                    problems.append(
                        f"{where}.automation[{i}]: uses {leaf.source}.{leaf.field} "
                        "but the agent does not subscribe to it"
                    )
            for act in rule.then:
                dev = devices.get(act.device)
                if dev is None:
                    problems.append(f"{where}.automation[{i}]: unknown device {act.device!r}")
                elif act.request is None and dev.owner != agent_id:
                    problems.append(
                        f"{where}.automation[{i}]: {act.device!r} is owned by {dev.owner!r}; "
                        f"use `request: {dev.owner}`"
                    )
                elif act.request is not None and act.request != dev.owner:
                    problems.append(
                        f"{where}.automation[{i}]: request goes to {act.request!r} "
                        f"but {act.device!r} is owned by {dev.owner!r}"
                    )
        for i, rule in enumerate(pol.requests):
            dev = devices.get(rule.device)
            if dev is None:
                problems.append(f"{where}.requests[{i}]: unknown device {rule.device!r}")
            elif dev.owner != agent_id:
                problems.append(
                    f"{where}.requests[{i}]: {rule.device!r} is not owned by {agent_id!r}"
                )
            if rule.from_ is not None and rule.from_ not in agents:
                problems.append(f"{where}.requests[{i}]: unknown requester {rule.from_!r}")
            if rule.deny_if is not None:
                _check_condition(rule.deny_if, f"{where}.requests[{i}]", agents, spaces, problems)


def _check_condition(
    cond: Condition,
    where: str,
    agents: dict[str, Agent],
    spaces: dict[str, Space],
    problems: list[str],
) -> None:
    for leaf in cond.leaves():
        if leaf.source is not None:
            provider = agents.get(leaf.source)
            if provider is None:
                problems.append(f"{where}: unknown source {leaf.source!r}")
            elif leaf.field not in provider.provides:
                problems.append(f"{where}: {leaf.source!r} does not provide {leaf.field!r}")
        else:
            if leaf.space not in spaces:
                problems.append(f"{where}: unknown space {leaf.space!r}")
            if leaf.field not in SPACE_FIELDS:
                problems.append(f"{where}: unknown space field {leaf.field!r} (see SPACE_FIELDS)")
