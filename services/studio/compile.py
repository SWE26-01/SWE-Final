"""Slots -> AgentSpec: the code half of "structure first, then fill in".

The LLM chose a template, a space and Marketplace skills. Here the skills' device kinds become the
space's real devices, and their rules, policies and energy-saving actions become plugin config.
Nothing the LLM wrote reaches the config except through these lookups."""

from __future__ import annotations

from pydantic import BaseModel

from homeconfig import HomeConfig
from studio.harness import check_text
from studio.slots import Slots
from studio.templates import HOME_AGENT_ID, KIND_NAMES, SPACE_NAMES, TEMPLATES


class AgentSpec(BaseModel):
    """A checked agent, ready to render (studio/render.py) and register in the Hub."""

    agent_id: str
    template: str
    role: str
    display_name: str
    description: str
    space: str
    skills: list[str]
    owned: list[str]
    subscribe_to: dict[str, list[str]]
    rules: list[dict]
    policies: list[dict]
    energy_saving: list[dict]
    request_acl: dict[str, list[str]]
    permissions: list[str]


def agent_id_for(slots: Slots, suffix: str) -> str:
    first = slots.skills[0] if slots.skills else "agent"
    return f"{slots.space}-{first}-{suffix}".replace("_", "-")


def compile_spec(
    slots: Slots, config: HomeConfig, suffix: str
) -> tuple[AgentSpec | None, list[str]]:
    """The spec, or the problems to send back to the LLM (and to show the user)."""
    errors: list[str] = []
    template = TEMPLATES.get(slots.template or "")
    if template is None:
        errors.append(f"template: choose one of {', '.join(TEMPLATES)}")
    if slots.space not in config.spaces:  # fillers return enums; this guards hand-made slots
        errors.append(f"space: choose one of {', '.join(config.spaces)}")
    unknown = [s for s in slots.skills if s not in config.skills]
    if unknown:
        errors.append(f"skills: not in the Marketplace: {', '.join(unknown)}")
    if not slots.skills and not slots.devices:
        errors.append("skills: choose at least one Marketplace skill or device kind")
    if not slots.display_name:
        errors.append("display_name: give the agent a short name")
    errors += check_text("display_name", slots.display_name)
    errors += check_text("description", slots.description)
    if errors or template is None or slots.space not in config.spaces:
        return None, errors

    devices = config.devices_in(slots.space)
    here = {d.kind for d in devices if d.kind}
    where = SPACE_NAMES.get(slots.space, slots.space)
    for kind in slots.devices:
        if kind not in here:
            errors.append(f"devices: {where} has no {KIND_NAMES.get(kind, kind)} ({kind})")
    skills = [config.skills[s] for s in dict.fromkeys(slots.skills)]
    for skill in skills:
        if template.id not in skill.templates:
            errors.append(f"skills: {skill.id} does not fit the {template.id} template")
        missing = [k for k in skill.needs_all if k not in here]
        if missing:
            names = ", ".join(f"{KIND_NAMES.get(k, k)} ({k})" for k in missing)
            errors.append(f"skills: {skill.id} needs {names}, which {where} does not have")
        if skill.needs_any and not here.intersection(skill.needs_any):
            errors.append(
                f"skills: {skill.id} needs one of {', '.join(skill.needs_any)} in {where}"
            )
    if errors:
        return None, errors

    wanted = set(slots.devices).union(*(s.kinds() & here for s in skills))
    by_kind: dict[str, list[str]] = {}
    for d in devices:
        if d.kind in wanted:
            by_kind.setdefault(d.kind, []).append(d.entity)
    owned = [e for es in by_kind.values() for e in es]
    if not owned:
        return None, [f"devices: the chosen skills use no device in {where}"]

    def act(kind: str, command: str, value: str | None) -> list[dict]:
        base = {"command": command} | ({"value": value} if value is not None else {})
        return [{"device": e, **base} for e in by_kind.get(kind, [])]

    rules, policies, energy, subscribe = [], [], [], {}
    for skill in skills:
        fired = False
        for rule in skill.rules:
            actions = [x for a in rule.actions for x in act(a.kind, a.command, a.value)]
            if actions:
                rules.append({"field": rule.field, "equals": rule.equals, "actions": actions})
                fired = True
        if fired:
            for peer, fields in skill.subscribes.items():
                subscribe.setdefault(peer, [])
                subscribe[peer] += [f for f in fields if f not in subscribe[peer]]
        for p in skill.policies:
            denied = [e for k in p.deny.kinds for e in by_kind.get(k, [])]
            for when in by_kind.get(p.when.kind, []) if denied else []:
                policies.append(
                    {
                        "when": {"entity": when, "state": p.when.state},
                        "deny": {"devices": denied, "commands": list(p.deny.commands)},
                        "reason_code": p.reason_code,
                        "message": p.message,
                    }
                )
        for a in skill.energy_saving:
            energy += [x for x in act(a.kind, a.command, a.value) if x not in energy]

    permissions = [f"device:{e}" for e in owned]
    permissions += [f"context:{peer}.{f}" for peer, fields in subscribe.items() for f in fields]
    spec = AgentSpec(
        agent_id=agent_id_for(slots, suffix),
        template=template.id,
        role=template.role,
        display_name=slots.display_name or "",
        description=slots.description or "",
        space=slots.space,
        skills=[s.id for s in skills],
        owned=owned,
        subscribe_to=subscribe,
        rules=rules,
        policies=policies,
        energy_saving=energy,
        request_acl={HOME_AGENT_ID: ["*"]},
        permissions=permissions,
    )
    return spec, []


def summarize(spec: AgentSpec, config: HomeConfig) -> list[str]:
    """What the agent will do, in plain Korean, for the user's review. Written by code from the
    spec, so it always matches what will run."""
    where = SPACE_NAMES.get(spec.space, spec.space)
    kinds = [KIND_NAMES.get(config.devices[e].kind or "", e) for e in spec.owned]
    lines = [f"{where}의 기기 {len(spec.owned)}개를 맡아요: {', '.join(dict.fromkeys(kinds))}"]
    for skill_id in spec.skills:
        skill = config.skills[skill_id]
        lines.append(f"스킬 {skill.name}: {skill.description}")
    for peer, fields in spec.subscribe_to.items():
        lines.append(f"{peer} 에이전트의 {', '.join(fields)} 정보를 구독해요")
    lines.append(
        f"규칙 {len(spec.rules)}개, 안전 정책 {len(spec.policies)}개, "
        f"절전 동작 {len(spec.energy_saving)}개"
    )
    lines.append("Home Agent의 요청을 받지만, 실행 여부는 이 에이전트의 정책이 정해요")
    lines.append("셸, 파일, 웹 도구는 없어요")
    return lines


class Picks(BaseModel):
    """What the user chose on screen: Marketplace skills and the room. Applied by code after the
    filler, so the LLM cannot drop them; compile and the harness still check them like any slot."""

    skills: list[str] = []
    space: str | None = None

    def hint(self, config: HomeConfig) -> str:
        """Told to the filler with the request (built from catalog values, never user text)."""
        parts = []
        if self.skills:
            names = ", ".join(f"{config.skills[s].name} ({s})" for s in self.skills)
            parts.append(f"Marketplace에서 사용자가 고른 스킬: {names}")
        if self.space:
            parts.append(f"공간: {SPACE_NAMES.get(self.space, self.space)} ({self.space})")
        return f"\n\n({'. '.join(parts)}. 이 선택은 그대로 쓴다.)" if parts else ""


def apply_picks(slots: Slots, picks: Picks, config: HomeConfig) -> Slots:
    """The user's picks win: picked skills come first and stay, a picked room replaces the
    filler's. With a room and at least one skill picked there is enough to build, even if the
    filler asked a question or refused."""
    if not picks.skills and picks.space is None:
        return slots
    skills = list(dict.fromkeys([*picks.skills, *slots.skills]))[:5]
    space = picks.space or slots.space
    if slots.outcome != "draft" and not (picks.skills and space):
        return slots
    where = SPACE_NAMES.get(space or "", space or "")
    names = ", ".join(config.skills[s].name for s in skills if s in config.skills)
    return slots.model_copy(
        update={
            "outcome": "draft",
            "template": slots.template or "room_agent",
            "space": space,
            "skills": skills,
            "display_name": slots.display_name or f"{where} 도우미",
            "description": slots.description or f"{where}에서 {names} 기능을 맡는 에이전트",
            "question": None,
            "reason": None,
        }
    )
