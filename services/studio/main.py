"""Agent Studio (Main 2): a natural-language request becomes a checked OpenClaw agent, which the
user approves and Studio registers in the Agent Hub.

POST /drafts runs "structure first, then fill in" (each step is in its own module):
1. input guard (harness.check_request): dangerous commands or injection -> `blocked`, no LLM call
2. fill the slots (filler.py): LangChain structured output, or the offline keyword filler
3. compile (compile.py): Marketplace skills -> devices, rules and policies of the chosen space
4. render (render.py) + capability lock (harness.check_rendered)
   Problems from 2-4 go back to the filler, at most MAX_REPAIRS more times, then `invalid`.
5. the user reviews the summary and files; POST /drafts/{id}/approve registers the agent in the
   Hub and writes agents/generated/<agent_id>/. Connecting it (permissions, token) is the Hub's job.

Run: uvicorn studio.main:build --factory --port 8500 --env-file ../.env
     (database: PostgreSQL with POSTGRES_HOST, else studio.sqlite; see common/db.py)
"""

# No `from __future__ import annotations`: FastAPI reads the common.auth annotations at runtime.
import logging
import os
import secrets
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import URL, select
from sqlalchemy.orm import Session, sessionmaker

from common.auth import make_auth
from common.cors import allow_dashboards
from common.db import database_url, make_engine
from common.logs import hide_tokens_in_server_logs
from homeconfig import HomeConfig, load_config
from homeconfig.models import Caller, CatalogSkill, Role
from studio.compile import AgentSpec, Picks, apply_picks, compile_spec, summarize
from studio.filler import Filler, LangChainFiller, RuleFiller
from studio.harness import PORT_RANGE, REQUEST_LIMIT, check_rendered, check_request, check_text
from studio.hubclient import HubClient, HubError
from studio.render import render
from studio.slots import Slots
from studio.store import Base, DraftRow, now
from studio.templates import SPACE_NAMES, TEMPLATES

log = logging.getLogger("studio")

MAX_REPAIRS = 2  # extra attempts after the first, with the problems fed back to the filler
PORT_STEP = (
    120  # OpenClaw gateways sit 120 ports apart, like the platform agents (scripts/run_all.sh)
)
DEFAULT_GENERATED_DIR = Path(__file__).resolve().parents[2] / "agents" / "generated"


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftRequest(_In):
    request: Annotated[str, Field(max_length=2000)] = ""  # the harness enforces 500
    skills: Annotated[list[str], Field(max_length=5)] = Field(
        default=[], description="skills picked in the Marketplace; kept whatever the LLM says"
    )
    space: str | None = Field(default=None, description="room picked on screen")


class Answer(_In):
    answer: Annotated[str, Field(min_length=1, max_length=200)]


class CheckRequest(_In):
    text: Annotated[str, Field(min_length=1, max_length=2000)]


class FindingOut(BaseModel):
    code: str
    message: str
    excerpt: str


class TemplateOut(BaseModel):
    id: str
    name: str
    description: str
    role: str


class DraftOut(BaseModel):
    id: str
    request: str
    picks: dict[str, Any]
    status: str
    filler: str
    attempts: int
    question: str | None
    reason: str | None
    findings: list[FindingOut]
    errors: list[str]
    warnings: list[str]
    summary: list[str]
    permissions: list[str]
    agent_id: str | None
    port: int | None
    spec: dict[str, Any] | None
    files: dict[str, str]
    created_at: datetime
    updated_at: datetime
    registered_at: datetime | None


def _out(row: DraftRow) -> DraftOut:
    return DraftOut(
        id=row.id,
        request=row.request,
        picks=row.picks,
        status=row.status,
        filler=row.filler,
        attempts=row.attempts,
        question=row.question,
        reason=row.reason,
        findings=[FindingOut(**f) for f in row.findings],
        errors=row.errors,
        warnings=row.warnings,
        summary=row.summary,
        permissions=(row.spec or {}).get("permissions", []),
        agent_id=row.agent_id,
        port=row.port,
        spec=row.spec,
        files=row.files,
        created_at=row.created_at,
        updated_at=row.updated_at,
        registered_at=row.registered_at,
    )


def _problem(code: int, reason_code: str, message: str, **extra: object) -> HTTPException:
    return HTTPException(code, {"reason_code": reason_code, "message": message, **extra})


def create_app(
    config: HomeConfig,
    filler: Filler,
    hub: HubClient,
    db_url: URL | str = "sqlite://",
    generated_dir: Path = DEFAULT_GENERATED_DIR,
) -> FastAPI:
    engine = make_engine(db_url)
    sessions = sessionmaker(engine, expire_on_commit=False)
    auth = make_auth(config)
    filler_name = (
        f"langchain:{filler.model}" if isinstance(filler, LangChainFiller) else filler.name
    )[:120]  # drafts.filler column

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        hide_tokens_in_server_logs()
        Base.metadata.create_all(engine)
        try:
            yield
        finally:
            hub.close()
            engine.dispose()

    app = FastAPI(title="Agent Studio", version="0.1.0", lifespan=lifespan)
    allow_dashboards(app, config)

    def get_db() -> Iterator[Session]:
        with sessions() as db:
            yield db

    def reader(who: auth.caller) -> Caller:
        if who.role not in (Role.USER, Role.OPERATOR):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "user or operator only")
        return who

    DB = Annotated[Session, Depends(get_db)]
    Reader = Annotated[Caller, Depends(reader)]

    def next_port(db: Session) -> int:
        used = set(db.scalars(select(DraftRow.port).where(DraftRow.status == "registered")).all())
        for port in range(PORT_RANGE.start, PORT_RANGE.stop, PORT_STEP):
            if port not in used:
                return port
        raise _problem(507, "NO_PORT", "no free port for another generated agent")

    def ownership_warnings(spec: AgentSpec) -> list[str]:
        try:
            owned_now = hub.ownership()
        except HubError as e:
            return [f"device ownership not checked: {e.detail}"]
        held: dict[str, list[str]] = {}
        for entity in spec.owned:
            owner = owned_now.get(entity)
            if owner and owner != spec.agent_id:
                held.setdefault(owner, []).append(entity)
        return [
            f"{owner} owns {', '.join(es)} now; disconnect {owner} in the Hub before connecting"
            for owner, es in held.items()
        ]

    def run_pipeline(db: Session, row: DraftRow) -> None:
        row.findings = [asdict(f) for f in check_request(row.request)]
        row.errors, row.warnings, row.summary, row.files = [], [], [], {}
        row.slots = row.spec = row.question = row.reason = row.agent_id = row.port = None
        row.attempts = 0
        row.updated_at = now()
        if row.findings:
            row.status = "blocked"  # nothing reaches the LLM
            return
        picks = Picks.model_validate(row.picks or {})
        feedback: list[str] = []
        # Without a request no LLM is asked, so a retry would give the same answer.
        for attempt in range(1, MAX_REPAIRS + 2 if row.request else 2):
            row.attempts = attempt
            try:
                if row.request:
                    filled = filler.fill(row.request + picks.hint(config), feedback)
                    slots = Slots.model_validate(filled.model_dump())
                else:  # only Marketplace picks: nothing for an LLM to read
                    names = ", ".join(SPACE_NAMES.get(s, s) for s in config.spaces)
                    slots = Slots(
                        outcome="clarify", question=f"어느 공간의 에이전트를 만들까요? ({names})"
                    )
                slots = apply_picks(slots, picks, config)
            except ValidationError as e:
                feedback = [f"form: {err['loc']}: {err['msg']}" for err in e.errors()][:5]
                continue
            except Exception as e:  # the LLM call itself failed: retrying the same call won't help
                log.warning("filler failed: %s", e.__class__.__name__)
                row.status, row.errors = "failed", [f"LLM call failed: {e.__class__.__name__}"]
                return
            row.slots = slots.model_dump()
            problems = check_text("question", slots.question) + check_text("reason", slots.reason)
            if not problems and slots.outcome == "clarify":
                row.status = "clarify"
                row.question = slots.question or "어느 공간의 에이전트인지 알려 주세요."
                return
            if not problems and slots.outcome == "unsupported":
                row.status = "unsupported"
                row.reason = slots.reason or "지금 지원하지 않는 요청이에요."
                return
            spec, problems = (
                (None, problems) if problems else compile_spec(slots, config, row.suffix)
            )
            if spec is not None:
                port = next_port(db)
                profile, files = render(spec, port, config, row.id)
                problems = check_rendered(profile, spec.agent_id, spec.owned, files["AGENTS.md"])
                if not problems:
                    row.status = "ready"
                    row.spec, row.files, row.port = spec.model_dump(), files, port
                    row.agent_id = spec.agent_id
                    row.summary = summarize(spec, config)
                    row.warnings = ownership_warnings(spec)
                    return
            feedback = problems
        row.status, row.errors = "invalid", feedback

    def find_draft(db: Session, draft_id: str) -> DraftRow:
        row = db.get(DraftRow, draft_id)
        if row is None:
            raise _problem(404, "UNKNOWN_DRAFT", f"no draft {draft_id!r}")
        return row

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "filler": filler_name}

    @app.get("/templates")
    async def list_templates(_: Reader) -> list[TemplateOut]:
        return [
            TemplateOut(id=t.id, name=t.name, description=t.description, role=t.role)
            for t in TEMPLATES.values()
        ]

    @app.get("/skills")
    async def list_skills(
        _: Reader,
        q: Annotated[str | None, Query(max_length=80)] = None,
        category: str | None = None,
        space: str | None = None,
    ) -> list[CatalogSkill]:
        """The Marketplace, for picking skills into a draft (same search as the Hub's)."""
        return config.search_skills(q, category, None, space)

    @app.post("/harness/check")
    async def harness_check(body: CheckRequest, _: Reader) -> list[FindingOut]:
        """What the input guard would refuse in `text` (for the screen and for demos)."""
        return [FindingOut(**asdict(f)) for f in check_request(body.text)]

    @app.post("/drafts", status_code=status.HTTP_201_CREATED)
    def create_draft(body: DraftRequest, db: DB, _: auth.user) -> DraftOut:
        """From a sentence, from Marketplace picks (skills, room), or both."""
        if not body.request.strip() and not body.skills:
            raise _problem(422, "EMPTY", "write a request or pick at least one skill")
        unknown = [s for s in body.skills if s not in config.skills]
        if unknown:
            raise _problem(422, "UNKNOWN_SKILL", f"not in the Marketplace: {', '.join(unknown)}")
        if body.space is not None and body.space not in config.spaces:
            raise _problem(422, "UNKNOWN_SPACE", f"no space {body.space!r}")
        row = DraftRow(
            id=secrets.token_hex(8),
            request=body.request.strip(),
            picks=Picks(skills=list(dict.fromkeys(body.skills)), space=body.space).model_dump(),
            status="new",
            filler=filler_name,
            suffix=secrets.token_hex(2),
        )
        db.add(row)
        run_pipeline(db, row)
        db.commit()
        return _out(row)

    @app.get("/drafts")
    def list_drafts(
        db: DB, _: Reader, limit: Annotated[int, Query(ge=1, le=200)] = 50
    ) -> list[DraftOut]:
        rows = db.scalars(select(DraftRow).order_by(DraftRow.created_at.desc()).limit(limit))
        return [_out(r) for r in rows]

    @app.get("/drafts/{draft_id}")
    def get_draft(draft_id: str, db: DB, _: Reader) -> DraftOut:
        return _out(find_draft(db, draft_id))

    @app.post("/drafts/{draft_id}/answer")
    def answer_draft(draft_id: str, body: Answer, db: DB, _: auth.user) -> DraftOut:
        """Answer Studio's question (status `clarify`); the request is run again with it."""
        row = find_draft(db, draft_id)
        if row.status != "clarify":
            raise _problem(409, "NOT_ASKING", f"draft {draft_id} is {row.status}, not clarify")
        row.request = "\n".join(filter(None, [row.request, body.answer.strip()]))[:REQUEST_LIMIT]
        run_pipeline(db, row)
        db.commit()
        return _out(row)

    @app.post("/drafts/{draft_id}/approve")
    def approve_draft(draft_id: str, db: DB, _: auth.user) -> DraftOut:
        """The user approves: register in the Hub, then write the OpenClaw profile."""
        row = find_draft(db, draft_id)
        if row.status != "ready" or row.spec is None:
            raise _problem(409, "NOT_READY", f"draft {draft_id} is {row.status}, not ready")
        spec = AgentSpec.model_validate(row.spec)
        port = next_port(db)  # another draft may have taken the previewed port meanwhile
        profile, files = render(spec, port, config, row.id)
        problems = check_rendered(profile, spec.agent_id, spec.owned, files["AGENTS.md"])
        if problems:
            raise _problem(
                422, "HARNESS", "the rendered agent breaks a harness rule", problems=problems
            )
        base = generated_dir.resolve()
        target = (base / spec.agent_id).resolve()
        if target.parent != base:
            raise _problem(422, "BAD_ID", f"agent id {spec.agent_id!r} leaves {base}")
        if target.exists():
            raise _problem(409, "EXISTS", f"{target} already exists")
        try:
            hub.register(
                {
                    "id": spec.agent_id,
                    "name": spec.display_name,
                    "description": spec.description,
                    "role": spec.role,
                    "space": spec.space,
                    "url": f"http://127.0.0.1:{port}/plugins/ambient",
                    "skills": spec.skills,
                    "owned_devices": spec.owned,
                    "permissions": spec.permissions,
                    "spec_id": row.id,
                }
            )
        except HubError as e:
            code = e.status if e.status in (409, 422) else 502
            raise _problem(code, "HUB", "the Hub did not register the agent", hub=e.detail) from e
        target.mkdir(parents=True)
        for name, text in files.items():
            (target / name).write_text(text, encoding="utf-8")
        row.status, row.port, row.files = "registered", port, files
        row.registered_at = row.updated_at = now()
        db.commit()
        return _out(row)

    return app


def choose_filler(config: HomeConfig, env: dict[str, str] | None = None) -> Filler:
    """STUDIO_LLM=rules forces the offline filler; otherwise LangChain when a key is set."""
    env = dict(os.environ) if env is None else env
    key = env.get("STUDIO_LLM_API_KEY") or env.get("OPENROUTER_API_KEY")
    if env.get("STUDIO_LLM", "langchain") == "rules" or not key:
        return RuleFiller(config)
    return LangChainFiller(
        config,
        model=env.get("STUDIO_MODEL", "anthropic/claude-haiku-5.5"),
        api_key=key,
        base_url=env.get("STUDIO_LLM_BASE_URL", "https://openrouter.ai/api/v1"),
    )


def build() -> FastAPI:
    """App for `uvicorn studio.main:build --factory` (config files + environment)."""
    config = load_config()
    studio = config.callers.get("studio")
    token = studio.token if studio and studio.role is Role.SERVICE else None
    hub = HubClient.connect(os.environ.get("STUDIO_HUB_URL", "http://127.0.0.1:8400"), token)
    generated = Path(os.environ.get("STUDIO_GENERATED_DIR") or DEFAULT_GENERATED_DIR)
    return create_app(config, choose_filler(config), hub, database_url("studio"), generated)
