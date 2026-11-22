"""Slots -> AgentSpec: the code half of "structure first, then fill in".

For a room agent the LLM chose a template, a space and built-in skills (config/skills.yaml). Here
the skills' device kinds become the space's real devices, and their rules, policies and
energy-saving actions become plugin config. Nothing the LLM wrote reaches the config except
through these lookups.

An assistant agent (anything else people ask for: a coach, a tutor, a planner) owns no device and
gets no rules. The LLM's one-line instructions go into its guide (AGENTS.md) after the harness
checked every line; its tools stay locked like every generated agent's."""

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
    space: str | None
    skills: list[str]
    owned: list[str]
    subscribe_to: dict[str, list[str]]
    rules: list[dict]
    policies: list[dict]
    energy_saving: list[dict]
    request_acl: dict[str, list[str]]
    permissions: list[str]
    instructions: list[str] = []
    routine: dict | None = None  # routine_agent: {"at": "HH:MM", "requests": [{device, command}]}


def agent_id_for(slots: Slots, suffix: str) -> str:
    first = slots.skills[0] if slots.skills else "agent"
    return f"{slots.space}-{first}-{suffix}".replace("_", "-")


ASSISTANT = "assistant_agent"
ROUTINE = "routine_agent"
COMMAND_WORDS = {"TURN_ON": "켜기", "TURN_OFF": "끄기"}


def compile_routine(
    slots: Slots, config: HomeConfig, suffix: str
) -> tuple[AgentSpec | None, list[str]]:
    errors: list[str] = []
    if slots.space not in config.spaces:
        errors.append(f"space: choose one of {', '.join(config.spaces)}")
    if not slots.at:
        errors.append("at: the daily time, HH:MM")
    if not slots.devices:
        errors.append("devices: the device kinds to ask for")
    if not slots.display_name:
        errors.append("display_name: give the agent a short name")
    errors += check_text("display_name", slots.display_name)
    errors += check_text("description", slots.description)
    if errors:
        return None, errors
    where = SPACE_NAMES.get(slots.space, slots.space)
    targets = [d for d in config.devices_in(slots.space) if d.kind in slots.devices]
    missing = [k for k in slots.devices if k not in {d.kind for d in targets}]
    if missing:
        names = ", ".join(f"{KIND_NAMES.get(k, k)} ({k})" for k in missing)
        return None, [f"devices: {where} has no {names}"]
    command = slots.command or "TURN_ON"
    requests = [{"device": d.entity, "command": command} for d in targets]
    kinds = ", ".join(dict.fromkeys(KIND_NAMES.get(d.kind or "", d.entity) for d in targets))
    template = TEMPLATES[ROUTINE]
    return AgentSpec(
        agent_id=f"routine-{suffix}",
        template=template.id,
        role=template.role,
        display_name=slots.display_name or "",
        description=slots.description or "",
        space=slots.space,
        skills=[],
        owned=[],
        subscribe_to={},
        rules=[],
        policies=[],
        energy_saving=[],
        request_acl={},
        permissions=[f"request:{r['device']}" for r in requests],
        instructions=[
            f"매일 {slots.at}에 Root Agent에게 {where} {kinds} {COMMAND_WORDS[command]}를 부탁한다",
            "Root Agent가 기기 주인 에이전트에게 넘기고, 주인의 정책이 실행 여부를 정한다",
        ],
        routine={"at": slots.at, "requests": requests},
    ), []


def compile_assistant(slots: Slots, suffix: str) -> tuple[AgentSpec | None, list[str]]:
    errors: list[str] = []
    if not slots.display_name:
        errors.append("display_name: give the agent a short name")
    lines = [line.strip() for line in slots.instructions if line and line.strip()]
    if len(lines) < 2:
        errors.append("instructions: write 3-10 short lines on how the agent helps")
    errors += check_text("display_name", slots.display_name)
    errors += check_text("description", slots.description)
    for i, line in enumerate(lines):
        errors += check_text(f"instructions[{i}]", line)
    if errors:
        return None, errors
    template = TEMPLATES[ASSISTANT]
    return AgentSpec(
        agent_id=f"assistant-{suffix}",
        template=template.id,
        role=template.role,
        display_name=slots.display_name or "",
        description=slots.description or "",
        space=None,
        skills=[],
        owned=[],
        subscribe_to={},
        rules=[],
        policies=[],
        energy_saving=[],
        request_acl={},
        permissions=[],
        instructions=lines,
    ), []


def compile_spec(
    slots: Slots, config: HomeConfig, suffix: str
) -> tuple[AgentSpec | None, list[str]]:
    """The spec, or the problems to send back to the LLM (and to show the user)."""
    if slots.template == ASSISTANT:
        return compile_assistant(slots, suffix)
    if slots.template == ROUTINE:
        return compile_routine(slots, config, suffix)
    errors: list[str] = []
    template = TEMPLATES.get(slots.template or "")
    if template is None:
        errors.append(f"template: choose one of {', '.join(TEMPLATES)}")
    if slots.space not in config.spaces:  # fillers return enums; this guards hand-made slots
        errors.append(f"space: choose one of {', '.join(config.spaces)}")
    unknown = [s for s in slots.skills if s not in config.skills]
    if unknown:
        errors.append(f"skills: not a built-in skill: {', '.join(unknown)}")
    if not slots.skills and not slots.devices:
        errors.append("skills: choose at least one skill or device kind")
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
    if spec.template == ROUTINE:
        return [
            *spec.instructions,
            "기기를 직접 움직이지 않아요. 연결할 때 '주인에게 요청' 권한만 승인해요",
            "Agent Cloud에서 '지금 실행'으로 바로 시험해 볼 수 있어요. 대화 탭에서 루틴을 "
            "물어볼 수도 있어요",
        ]
    if spec.template == ASSISTANT:
        return [
            "대화형 에이전트예요. Agent Cloud에서 연결한 뒤 '대화' 탭에서 이야기해요",
            *[f"지침: {line}" for line in spec.instructions],
            "집의 기기는 맡지 않고, 다른 에이전트의 정보도 읽지 않아요",
            "셸, 파일, 웹 도구는 없어요. 인터넷 검색 없이 알고 있는 지식으로 답하고, "
            "확실하지 않으면 그렇다고 말해요",
        ]
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
    """The room the user picked on screen. Applied by code after the filler, so the LLM cannot
    change it; compile and the harness still check it like any slot."""

    space: str | None = None

    def hint(self) -> str:
        """Told to the filler with the request (built from catalog values, never user text)."""
        if not self.space:
            return ""
        where = SPACE_NAMES.get(self.space, self.space)
        return f"\n\n(공간: {where} ({self.space}). 이 선택은 그대로 쓴다.)"


def apply_picks(slots: Slots, picks: Picks) -> Slots:
    """A picked room replaces the filler's in a draft."""
    if picks.space is None or slots.outcome != "draft":
        return slots
    return slots.model_copy(update={"space": picks.space})
