"""Agent Studio (Main 2): a natural-language request becomes a checked agent, which the user
approves and Studio registers in the Agent Hub.

POST /drafts runs "structure first, then fill in" (each step is in its own module):
1. input guard (harness.check_request): dangerous commands or injection -> `blocked`, no LLM call
2. fill the slots (filler.py): LangChain structured output, or the offline keyword filler
3. compile (compile.py): built-in skills -> a runtime-neutral AgentSpec for the chosen space
4. build for the runtime (runtime.py; today OpenClaw: render.py + harness.check_rendered)
   Problems from 2-4 go back to the filler, at most MAX_REPAIRS more times, then `invalid`.
5. the user reviews the summary and files; POST /drafts/{id}/approve registers the agent in the
   Hub and writes agents/generated/<agent_id>/. Connecting it (permissions, token) is the Hub's job.
STUDIO_RUNTIME picks the runtime (runtime.py). No Skill Marketplace: users pick a room only.

Run: uvicorn studio.main:build --factory --port 8500 --env-file ../.env
     (database: PostgreSQL with POSTGRES_HOST, else studio.sqlite; see common/db.py)
"""

# No `from __future__ import annotations`: FastAPI reads the route annotations at runtime.
import hashlib
import logging
import os
import secrets
import time
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import URL, select
from sqlalchemy.orm import Session, sessionmaker

from common.cors import allow_dashboards
from common.db import add_missing_columns, database_url, ensure_database, make_engine
from common.logs import hide_tokens_in_server_logs
from homeconfig import HomeConfig, load_config
from homeconfig.models import Caller, Role
from studio.compile import AgentSpec, Picks, apply_picks, compile_spec, summarize
from studio.filler import Filler, LangChainFiller, RuleFiller
from studio.harness import REQUEST_LIMIT, check_request, check_text
from studio.hubclient import HubClient, HubError
from studio.runtime import OpenClawRuntime, Runtime, choose_runtime
from studio.slots import Slots
from studio.store import Base, DraftRow, now
from studio.templates import TEMPLATES

log = logging.getLogger("studio")

SESSION_CACHE_SECONDS = 30  # how long a person's session answer from the Hub is reused
MAX_REPAIRS = 2  # extra attempts after the first, with the problems fed back to the filler
DEFAULT_GENERATED_DIR = Path(__file__).resolve().parents[2] / "agents" / "generated"


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftRequest(_In):
    request: Annotated[str, Field(max_length=2000)]  # the harness enforces 500
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
    owner: str | None = None


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
        owner=row.owner,
    )


def _problem(code: int, reason_code: str, message: str, **extra: object) -> HTTPException:
    return HTTPException(code, {"reason_code": reason_code, "message": message, **extra})


def create_app(
    config: HomeConfig,
    filler: Filler,
    hub: HubClient,
    db_url: URL | str = "sqlite://",
    generated_dir: Path = DEFAULT_GENERATED_DIR,
    runtime: Runtime | None = None,
) -> FastAPI:
    runtime = runtime or OpenClawRuntime(config)
    engine = make_engine(db_url)
    sessions = sessionmaker(engine, expire_on_commit=False)
    sessions_seen: dict[str, tuple[float, Caller]] = {}  # sha256(token) -> (until, caller)
    filler_name = (
        f"langchain:{filler.model}" if isinstance(filler, LangChainFiller) else filler.name
    )[:120]  # drafts.filler column

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        hide_tokens_in_server_logs()
        ensure_database(db_url)
        Base.metadata.create_all(engine)
        add_missing_columns(engine, Base.metadata)
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

    bearer = HTTPBearer(auto_error=False)

    def caller(cred: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> Caller:
        """A config caller, or a person logged in to the Hub (the Hub is asked, then the answer is
        kept for SESSION_CACHE_SECONDS)."""
        if cred is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing or unknown bearer token")
        found = config.caller_by_token(cred.credentials)
        if found is not None:
            return found
        key = hashlib.sha256(cred.credentials.encode()).hexdigest()
        hit = sessions_seen.get(key)
        if hit is not None and hit[0] > time.monotonic():
            return hit[1]
        try:
            me = hub.me(cred.credentials)
        except HubError as e:
            if e.status == 401:
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED, "missing or unknown bearer token"
                ) from e
            raise _problem(503, "HUB", "cannot check the login with the Hub") from e
        who = Caller(id=me["id"], role=Role(me["role"]), token=cred.credentials)
        if len(sessions_seen) > 1000:
            sessions_seen.clear()
        sessions_seen[key] = (time.monotonic() + SESSION_CACHE_SECONDS, who)
        return who

    def a_user(who: Annotated[Caller, Depends(caller)]) -> Caller:
        if who.role is not Role.USER:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "user only")
        return who

    def reader(who: Annotated[Caller, Depends(caller)]) -> Caller:
        if who.role not in (Role.USER, Role.OPERATOR):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "user or operator only")
        return who

    DB = Annotated[Session, Depends(get_db)]
    User = Annotated[Caller, Depends(a_user)]
    Reader = Annotated[Caller, Depends(reader)]

    def member(who: Caller) -> bool:
        """A Hub account: sees only its own drafts. Config callers see all of them."""
        return who.id not in config.callers

    def next_port(db: Session) -> int:
        used = set(db.scalars(select(DraftRow.port).where(DraftRow.status == "registered")).all())
        for port in runtime.ports:
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
        for attempt in range(1, MAX_REPAIRS + 2):
            row.attempts = attempt
            try:
                filled = filler.fill(row.request + picks.hint(), feedback)
                slots = apply_picks(Slots.model_validate(filled.model_dump()), picks)
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
                files, problems = runtime.build(spec, port, row.id)
                if not problems:
                    row.status = "ready"
                    row.spec, row.files, row.port = spec.model_dump(), files, port
                    row.agent_id = spec.agent_id
                    row.summary = summarize(spec, config)
                    row.warnings = ownership_warnings(spec)
                    return
            feedback = problems
        row.status, row.errors = "invalid", feedback

    def find_draft(db: Session, draft_id: str, who: Caller) -> DraftRow:
        row = db.get(DraftRow, draft_id)
        if row is None or (member(who) and row.owner != who.id):
            raise _problem(404, "UNKNOWN_DRAFT", f"no draft {draft_id!r}")
        return row

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "filler": filler_name, "runtime": runtime.name}

    @app.get("/templates")
    async def list_templates(_: Reader) -> list[TemplateOut]:
        return [
            TemplateOut(id=t.id, name=t.name, description=t.description, role=t.role)
            for t in TEMPLATES.values()
        ]

    @app.post("/harness/check")
    async def harness_check(body: CheckRequest, _: Reader) -> list[FindingOut]:
        """What the input guard would refuse in `text` (for the screen and for demos)."""
        return [FindingOut(**asdict(f)) for f in check_request(body.text)]

    @app.post("/drafts", status_code=status.HTTP_201_CREATED)
    def create_draft(body: DraftRequest, db: DB, who: User) -> DraftOut:
        """From a sentence, optionally with a room picked on screen."""
        if not body.request.strip():
            raise _problem(422, "EMPTY", "write a request")
        if body.space is not None and body.space not in config.spaces:
            raise _problem(422, "UNKNOWN_SPACE", f"no space {body.space!r}")
        row = DraftRow(
            id=secrets.token_hex(8),
            request=body.request.strip(),
            picks=Picks(space=body.space).model_dump(),
            status="new",
            filler=filler_name,
            suffix=secrets.token_hex(2),
            owner=who.id,
        )
        db.add(row)
        run_pipeline(db, row)
        db.commit()
        return _out(row)

    @app.get("/drafts")
    def list_drafts(
        db: DB, who: Reader, limit: Annotated[int, Query(ge=1, le=200)] = 50
    ) -> list[DraftOut]:
        query = select(DraftRow).order_by(DraftRow.created_at.desc()).limit(limit)
        if member(who):
            query = query.where(DraftRow.owner == who.id)
        rows = db.scalars(query)
        return [_out(r) for r in rows]

    @app.get("/drafts/{draft_id}")
    def get_draft(draft_id: str, db: DB, who: Reader) -> DraftOut:
        return _out(find_draft(db, draft_id, who))

    @app.post("/drafts/{draft_id}/answer")
    def answer_draft(draft_id: str, body: Answer, db: DB, who: User) -> DraftOut:
        """Answer Studio's question (status `clarify`); the request is run again with it."""
        row = find_draft(db, draft_id, who)
        if row.status != "clarify":
            raise _problem(409, "NOT_ASKING", f"draft {draft_id} is {row.status}, not clarify")
        row.request = "\n".join(filter(None, [row.request, body.answer.strip()]))[:REQUEST_LIMIT]
        run_pipeline(db, row)
        db.commit()
        return _out(row)

    @app.post("/drafts/{draft_id}/approve")
    def approve_draft(draft_id: str, db: DB, who: User) -> DraftOut:
        """The user approves: register in the Hub (as made by them), then write the runtime's
        files. The agent starts private to its maker; they can share it in the Hub."""
        row = find_draft(db, draft_id, who)
        if row.status != "ready" or row.spec is None:
            raise _problem(409, "NOT_READY", f"draft {draft_id} is {row.status}, not ready")
        spec = AgentSpec.model_validate(row.spec)
        port = next_port(db)  # another draft may have taken the previewed port meanwhile
        files, problems = runtime.build(spec, port, row.id)
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
                    "url": runtime.url(spec, port),
                    "skills": spec.skills,
                    "owned_devices": spec.owned,
                    "permissions": spec.permissions,
                    "spec_id": row.id,
                    "created_by": row.owner or who.id,
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
    db_url = database_url("studio")
    return create_app(config, choose_filler(config), hub, db_url, generated, choose_runtime(config))
