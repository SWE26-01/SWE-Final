"""Agent Hub (Main 2): the registry of the home's agents and the place where the user connects them.

- Registry and discovery: platform agents (config/agents.yaml) are seeded at startup; Studio
  registers the agents it creates (POST /agents); an external agent signs up with its Agent Card
  URL (POST /agents/discover). GET /agents searches by name, skill, space and role.
- Skill Marketplace: GET /skills searches config/skills.yaml and says which rooms can run each
  skill.
- Connections: the user approves an agent's permissions (POST /connections). The Hub checks that
  every device has exactly one owner, issues a per-agent token and stores only its hash.
  DELETE /connections/{id} revokes the token, the permissions and the device ownership at once.
- Runtime checks: POST /tokens/verify, GET /ownership and GET /runtime/* answer the Gateway and the
  agents. The Hub manages and routes; the agent that owns a device still makes the final decision.
- Monitoring: GET /agents/{id}/activity joins the Hub's own record of the agent (registered,
  connected ...) with the requests it took part in, from the Event Collector's GET /flows.

Run: uvicorn agenthub.main:build --factory --port 8400 --env-file ../.env
     (database: PostgreSQL with POSTGRES_HOST, else hub.sqlite; see common/db.py)
"""

# No `from __future__ import annotations`: FastAPI reads the common.auth annotations at runtime.
import asyncio
import logging
import os
import secrets
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Annotated, Literal

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import URL, select
from sqlalchemy.orm import Session, sessionmaker

from agenthub.cards import CardError, CardInfo, fetch_card, read_card
from agenthub.store import (
    AgentRow,
    AuditRow,
    Base,
    ConnectionRow,
    active_connection,
    audit,
    now,
    owners,
    token_hash,
)
from common.auth import make_auth
from common.cors import allow_dashboards
from common.db import database_url, make_engine
from common.logs import hide_tokens_in_server_logs
from homeconfig import HomeConfig, load_config
from homeconfig.models import Caller, CatalogSkill, EntityId, FieldName, Role

log = logging.getLogger("agenthub")

AgentId = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]*$", max_length=64)]
# device:<entity> owns and commands a device; context:<agent>.<field> reads another agent's context.
Permission = Annotated[
    str,
    Field(
        pattern=r"^(device:[a-z_]+\.[a-z0-9_]+|context:[a-z0-9][a-z0-9_-]*\.[a-z][a-z0-9_]*)$",
        max_length=140,
    ),
]


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentRegistration(_In):
    """What Studio sends for an agent it created (studio/main.py `approve`)."""

    id: AgentId
    name: Annotated[str, Field(min_length=1, max_length=80)]
    description: Annotated[str, Field(max_length=300)] = ""
    role: Literal["room", "home", "external"]
    space: str | None = None
    url: Annotated[str, Field(max_length=300)] | None = None
    skills: Annotated[list[str], Field(max_length=10)] = []
    owned_devices: list[EntityId] = []
    provided_fields: list[FieldName] = []
    permissions: list[Permission] = []
    spec_id: Annotated[str, Field(max_length=64)] | None = None


class DiscoverRequest(_In):
    card_url: Annotated[str, Field(min_length=1, max_length=300)]
    id: AgentId | None = None  # default: from the card's name


class ConnectRequest(_In):
    agent_id: AgentId
    permissions: list[Permission] | None = Field(
        default=None, description="what the user approves; default: everything the agent asks for"
    )


class VerifyRequest(_In):
    token: Annotated[str, Field(min_length=1, max_length=200)]


class AgentOut(BaseModel):
    id: str
    name: str
    description: str
    origin: str
    role: str | None
    space: str | None
    url: str | None
    skills: list[str]
    owned_devices: list[str]
    provided_fields: list[str]
    permissions: list[str]
    spec_id: str | None
    removed: bool
    connected: bool
    connection_id: str | None
    created_at: datetime


class ConnectionOut(BaseModel):
    id: str
    agent_id: str
    space: str | None
    permissions: list[str]
    active: bool
    platform: bool = Field(description="token lives in the root .env, not issued by the Hub")
    token_env: str | None
    created_at: datetime
    created_by: str
    revoked_at: datetime | None
    revoked_by: str | None


class Connected(ConnectionOut):
    token: str | None = Field(description="shown once; None for platform agents")


class VerifyResult(BaseModel):
    active: bool
    agent_id: str | None = None
    connection_id: str | None = None
    permissions: list[str] = []


class AuditOut(BaseModel):
    ts: datetime
    actor: str
    action: str
    agent_id: str | None
    connection_id: str | None
    detail: str


class AgentActivity(BaseModel):
    agent_id: str
    hub: list[AuditOut] = Field(description="the Hub's record of this agent, newest first")
    flows: list[dict] = Field(
        description="requests it took part in, newest first (Collector flow summaries, "
        "contracts/collector/flow.schema.json)"
    )
    collector: str = Field(description="ok, or why the flows are missing")


class DeviceOut(BaseModel):
    entity: str
    kind: str | None
    owner: str | None = Field(description="agent that owns it now (active connection)")
    configured_owner: str = Field(description="owner in config/devices.yaml (the Gateway's table)")


class SpaceOut(BaseModel):
    id: str
    devices: list[DeviceOut]


def _problem(code: int, reason_code: str, message: str, **extra: object) -> HTTPException:
    return HTTPException(code, {"reason_code": reason_code, "message": message, **extra})


def _token_env(agent_id: str) -> str:
    return "AMBIENT_TOKEN_" + agent_id.upper().replace("-", "_")


def _agent_out(row: AgentRow, conn: ConnectionRow | None) -> AgentOut:
    return AgentOut(
        id=row.id,
        name=row.name,
        description=row.description,
        origin=row.origin,
        role=row.role,
        space=row.space,
        url=row.url,
        skills=row.skills,
        owned_devices=row.owned_devices,
        provided_fields=row.provided_fields,
        permissions=row.permissions,
        spec_id=row.spec_id,
        removed=row.removed,
        connected=conn is not None,
        connection_id=conn.id if conn else None,
        created_at=row.created_at,
    )


def _connection_out(c: ConnectionRow) -> ConnectionOut:
    return ConnectionOut(
        id=c.id,
        agent_id=c.agent_id,
        space=c.space,
        permissions=c.permissions,
        active=c.active,
        platform=c.token_hash is None,
        token_env=c.token_env,
        created_at=c.created_at,
        created_by=c.created_by,
        revoked_at=c.revoked_at,
        revoked_by=c.revoked_by,
    )


def _apply_card(row: AgentRow, info: CardInfo, card: dict) -> None:
    row.description = info.description or row.description
    row.role = info.role or row.role
    row.space = info.space or row.space
    row.provided_fields = info.provided_fields or row.provided_fields
    row.skills = info.skills or row.skills
    row.card = card
    row.updated_at = now()


def seed_platform_agents(db: Session, config: HomeConfig) -> None:
    """Register the home's own agents once, connected with the devices devices.yaml gives them.
    A platform agent the user later disconnected stays disconnected after a restart."""
    for caller in config.agents():
        row = db.get(AgentRow, caller.id)
        if row is not None:
            row.url = caller.url
            continue
        owned = config.owned_by(caller.id)
        spaces = {config.devices[e].space for e in owned}
        perms = [f"device:{e}" for e in owned]
        row = AgentRow(
            id=caller.id,
            name=caller.id,
            origin="platform",
            space=spaces.pop() if len(spaces) == 1 else None,
            url=caller.url,
            owned_devices=owned,
            permissions=perms,
        )
        db.add(row)
        db.add(
            ConnectionRow(
                id=secrets.token_hex(8),
                agent_id=caller.id,
                space=row.space,
                permissions=perms,
                token_hash=None,
                token_env=caller.token_env,
                created_by="platform",
            )
        )
        audit(db, "platform", "register", caller.id, detail="platform agent (config/agents.yaml)")
    db.commit()


def refresh_platform_cards(
    sessions: sessionmaker[Session], client: httpx.Client, agents_host: str | None = None
) -> None:
    """Fill role, fields and skills of the platform agents from their running Agent Cards.
    Best effort: agents that are not running keep what config gave them."""
    with sessions() as db:
        for row in db.scalars(select(AgentRow).where(AgentRow.origin == "platform")):
            if not row.url:
                continue
            try:
                card = fetch_card(client, row.url, agents_host)
                _apply_card(row, read_card(card), card)
            except CardError as e:
                log.info("card of %s not available: %s", row.id, e)
        db.commit()


def create_app(
    config: HomeConfig,
    db_url: URL | str = "sqlite://",
    *,
    sync_cards: bool = True,
    card_transport: httpx.BaseTransport | None = None,
    agents_host: str | None = None,
    collector_url: str | None = None,
    collector_transport: httpx.BaseTransport | None = None,
) -> FastAPI:
    """Build the Hub. Tables are created and platform agents seeded at startup; their Agent Cards
    are read in the background (`sync_cards=False` skips that, for tests). With `collector_url`
    the Hub reads request flows from the Event Collector with the operator (dashboard) token."""
    engine = make_engine(db_url)
    sessions = sessionmaker(engine, expire_on_commit=False)
    cards = httpx.Client(transport=card_transport)
    operator = next((c for c in config.callers.values() if c.role is Role.OPERATOR), None)
    collector = (
        httpx.Client(
            base_url=collector_url.rstrip("/"),
            headers={"Authorization": f"Bearer {operator.token}"} if operator else {},
            transport=collector_transport,
            timeout=5,
        )
        if collector_url
        else None
    )
    auth = make_auth(config)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        hide_tokens_in_server_logs()
        Base.metadata.create_all(engine)
        with sessions() as db:
            seed_platform_agents(db, config)
        task = (
            asyncio.create_task(
                asyncio.to_thread(refresh_platform_cards, sessions, cards, agents_host)
            )
            if sync_cards
            else None
        )
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
            cards.close()
            if collector is not None:
                collector.close()
            engine.dispose()

    app = FastAPI(title="Agent Hub", version="0.1.0", lifespan=lifespan)
    allow_dashboards(app, config)

    def get_db() -> Iterator[Session]:
        with sessions() as db:
            yield db

    DB = Annotated[Session, Depends(get_db)]

    def find_agent(db: Session, agent_id: str) -> AgentRow:
        row = db.get(AgentRow, agent_id)
        if row is None or row.removed:
            raise _problem(404, "UNKNOWN_AGENT", f"no agent {agent_id!r}")
        return row

    def check_registration(reg: AgentRegistration) -> None:
        problems: list[str] = []
        if reg.space is not None and reg.space not in config.spaces:
            problems.append(f"unknown space {reg.space!r}")
        for skill in reg.skills:
            if skill not in config.skills:
                problems.append(f"unknown skill {skill!r}")
        for entity in reg.owned_devices:
            device = config.devices.get(entity)
            if device is None:
                problems.append(f"unknown device {entity!r}")
            elif reg.space is not None and device.space != reg.space:
                problems.append(f"{entity} is in {device.space}, not {reg.space}")
            if f"device:{entity}" not in reg.permissions:
                problems.append(f"owns {entity} but does not ask for device:{entity}")
        if problems:
            raise _problem(422, "INVALID_REGISTRATION", "; ".join(problems))

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True}

    @app.get("/skills")
    async def list_skills(
        _: auth.caller,
        q: Annotated[str | None, Query(max_length=80)] = None,
        category: str | None = None,
        template: str | None = None,
        space: str | None = None,
    ) -> list[CatalogSkill]:
        """Marketplace search. `space` keeps only the skills that room's devices can run."""
        return config.search_skills(q, category, template, space)

    @app.get("/skills/{skill_id}")
    async def get_skill(skill_id: str, _: auth.caller) -> CatalogSkill:
        skill = config.skills.get(skill_id)
        if skill is None:
            raise _problem(404, "UNKNOWN_SKILL", f"no skill {skill_id!r}")
        return CatalogSkill(**skill.model_dump(), available_spaces=config.spaces_for(skill))

    @app.get("/spaces")
    def list_spaces(db: DB, _: auth.caller) -> list[SpaceOut]:
        now_owned = owners(db)
        return [
            SpaceOut(
                id=space,
                devices=[
                    DeviceOut(
                        entity=d.entity,
                        kind=d.kind,
                        owner=now_owned.get(d.entity),
                        configured_owner=d.owner,
                    )
                    for d in config.devices_in(space)
                ],
            )
            for space in config.spaces
        ]

    @app.get("/ownership")
    def ownership(db: DB, _: auth.caller) -> dict[str, str | None]:
        now_owned = owners(db)
        return {entity: now_owned.get(entity) for entity in config.devices}

    @app.get("/agents")
    def list_agents(
        db: DB,
        _: auth.caller,
        q: Annotated[str | None, Query(max_length=80)] = None,
        skill: str | None = None,
        space: str | None = None,
        role: str | None = None,
        origin: str | None = None,
        connected: bool | None = None,
        include_removed: bool = False,
    ) -> list[AgentOut]:
        conns = {
            c.agent_id: c for c in db.scalars(select(ConnectionRow).where(ConnectionRow.active))
        }
        found = []
        for row in db.scalars(select(AgentRow).order_by(AgentRow.created_at, AgentRow.id)):
            if row.removed and not include_removed:
                continue
            text = f"{row.id} {row.name} {row.description}".lower()
            if q and q.lower() not in text:
                continue
            if skill and skill not in row.skills:
                continue
            if (space and row.space != space) or (role and row.role != role):
                continue
            if origin and row.origin != origin:
                continue
            if connected is not None and (row.id in conns) != connected:
                continue
            found.append(_agent_out(row, conns.get(row.id)))
        return found

    @app.get("/agents/{agent_id}")
    def get_agent(agent_id: str, db: DB, _: auth.caller) -> AgentOut:
        row = db.get(AgentRow, agent_id)
        if row is None:
            raise _problem(404, "UNKNOWN_AGENT", f"no agent {agent_id!r}")
        return _agent_out(row, active_connection(db, agent_id))

    @app.post("/agents", status_code=status.HTTP_201_CREATED)
    def register_agent(reg: AgentRegistration, db: DB, who: auth.service) -> AgentOut:
        check_registration(reg)
        old = db.get(AgentRow, reg.id)
        if old is not None and not old.removed:
            raise _problem(409, "AGENT_EXISTS", f"agent {reg.id!r} is already registered")
        if old is not None:
            db.delete(old)
            db.flush()
        row = AgentRow(origin="studio", **reg.model_dump())
        db.add(row)
        audit(db, who.id, "register", reg.id, detail=f"skills: {', '.join(reg.skills)}")
        db.commit()
        return _agent_out(row, None)

    @app.post("/agents/discover", status_code=status.HTTP_201_CREATED)
    def discover_agent(body: DiscoverRequest, db: DB, who: auth.user) -> AgentOut:
        """Register an external agent from its Agent Card. Registering grants nothing: the agent
        works only after the user connects it and approves its permissions."""
        try:
            card = fetch_card(cards, body.card_url, agents_host)
            info = read_card(card)
        except CardError as e:
            raise _problem(422, "INVALID_CARD", str(e)) from e
        agent_id = body.id or _slug(info.name)
        if not agent_id:
            raise _problem(422, "INVALID_CARD", "card name gives no usable id; pass `id`")
        old = db.get(AgentRow, agent_id)
        if old is not None and not old.removed:
            raise _problem(409, "AGENT_EXISTS", f"agent {agent_id!r} is already registered")
        if old is not None:
            db.delete(old)
            db.flush()
        unknown = [d for d in info.owned_devices if d not in config.devices]
        if unknown:
            raise _problem(
                422, "INVALID_CARD", f"card claims unknown devices: {', '.join(unknown)}"
            )
        row = AgentRow(
            id=agent_id,
            name=info.name,
            description=info.description,
            origin="external",
            role=info.role,
            space=info.space if info.space in config.spaces else None,
            url=info.base_url,
            skills=info.skills,
            owned_devices=info.owned_devices,
            provided_fields=info.provided_fields,
            permissions=[f"device:{d}" for d in info.owned_devices],
            card=card,
        )
        db.add(row)
        audit(db, who.id, "discover", agent_id, detail=info.base_url)
        db.commit()
        return _agent_out(row, None)

    @app.post("/agents/{agent_id}/refresh")
    def refresh_agent(agent_id: str, db: DB, who: auth.user) -> AgentOut:
        row = find_agent(db, agent_id)
        if not row.url:
            raise _problem(422, "NO_URL", f"{agent_id} has no A2A URL")
        try:
            card = fetch_card(cards, row.url, agents_host)
            info = read_card(card)
        except CardError as e:
            raise _problem(502, "CARD_UNAVAILABLE", str(e)) from e
        _apply_card(row, info, card)
        audit(db, who.id, "refresh", agent_id)
        db.commit()
        return _agent_out(row, active_connection(db, agent_id))

    @app.delete("/agents/{agent_id}")
    def remove_agent(agent_id: str, db: DB, who: auth.user) -> AgentOut:
        row = find_agent(db, agent_id)
        if row.origin == "platform":
            raise _problem(
                400, "PLATFORM_AGENT", "platform agents can be disconnected, not removed"
            )
        conn = active_connection(db, agent_id)
        if conn is not None:
            _revoke(conn, who)
        row.removed = True
        row.updated_at = now()
        audit(db, who.id, "remove", agent_id)
        db.commit()
        return _agent_out(row, None)

    def _revoke(conn: ConnectionRow, who: Caller) -> None:
        conn.active = False
        conn.revoked_at = now()
        conn.revoked_by = who.id

    @app.get("/connections")
    def list_connections(
        db: DB, _: auth.caller, agent_id: str | None = None, active: bool | None = None
    ) -> list[ConnectionOut]:
        query = select(ConnectionRow).order_by(ConnectionRow.created_at)
        if agent_id is not None:
            query = query.where(ConnectionRow.agent_id == agent_id)
        if active is not None:
            query = query.where(ConnectionRow.active == active)
        return [_connection_out(c) for c in db.scalars(query)]

    @app.post("/connections", status_code=status.HTTP_201_CREATED)
    def connect(body: ConnectRequest, db: DB, who: auth.user) -> Connected:
        """Connect an agent with the permissions the user approved. Each device keeps exactly one
        owner: a device another connected agent owns must be released (disconnected) first."""
        row = find_agent(db, body.agent_id)
        if active_connection(db, row.id) is not None:
            raise _problem(409, "ALREADY_CONNECTED", f"{row.id} is already connected")
        approved = row.permissions if body.permissions is None else body.permissions
        extra = [p for p in approved if p not in row.permissions]
        if extra:
            raise _problem(
                422, "NOT_REQUESTED", "the agent did not ask for these permissions", extra=extra
            )
        devices = [p.removeprefix("device:") for p in approved if p.startswith("device:")]
        unknown = [d for d in devices if d not in config.devices]
        if unknown:
            raise _problem(422, "UNKNOWN_DEVICE", f"unknown devices: {', '.join(unknown)}")
        taken = {d: o for d, o in owners(db).items() if d in devices and o != row.id}
        if taken:
            holders = ", ".join(sorted(set(taken.values())))
            raise _problem(
                409,
                "OWNERSHIP_CONFLICT",
                f"each device has one owner; disconnect {holders} first",
                owners=taken,
            )
        for p in approved:
            if p.startswith("context:"):
                peer = p.removeprefix("context:").split(".", 1)[0]
                if db.get(AgentRow, peer) is None:
                    raise _problem(422, "UNKNOWN_AGENT", f"{p}: no agent {peer!r}")
        platform = row.origin == "platform"
        token = None if platform else secrets.token_urlsafe(32)
        caller = config.callers.get(row.id)
        conn = ConnectionRow(
            id=secrets.token_hex(8),
            agent_id=row.id,
            space=row.space,
            permissions=list(approved),
            token_hash=None if token is None else token_hash(token),
            token_env=caller.token_env if platform and caller else _token_env(row.id),
            created_by=who.id,
        )
        db.add(conn)
        audit(db, who.id, "connect", row.id, conn.id, detail=f"{len(approved)} permissions")
        db.commit()
        return Connected(**_connection_out(conn).model_dump(), token=token)

    @app.delete("/connections/{connection_id}")
    def disconnect(connection_id: str, db: DB, who: auth.user) -> ConnectionOut:
        conn = db.get(ConnectionRow, connection_id)
        if conn is None:
            raise _problem(404, "UNKNOWN_CONNECTION", f"no connection {connection_id!r}")
        if not conn.active:
            raise _problem(409, "ALREADY_REVOKED", f"connection {connection_id} is already revoked")
        _revoke(conn, who)
        audit(db, who.id, "disconnect", conn.agent_id, conn.id)
        db.commit()
        return _connection_out(conn)

    @app.post("/tokens/verify")
    def verify_token(body: VerifyRequest, db: DB, who: auth.caller) -> VerifyResult:
        """For the Gateway and the agents: is this Hub-issued token connected, and for what?"""
        if who.role not in (Role.AGENT, Role.SERVICE):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "agents and services only")
        conn = db.scalars(
            select(ConnectionRow).where(
                ConnectionRow.token_hash == token_hash(body.token), ConnectionRow.active
            )
        ).first()
        if conn is None:
            return VerifyResult(active=False)
        return VerifyResult(
            active=True, agent_id=conn.agent_id, connection_id=conn.id, permissions=conn.permissions
        )

    @app.get("/runtime/peers")
    def runtime_peers(db: DB, _: auth.caller) -> dict[str, str]:
        """A2A base URL of every connected agent (what agents/shared.json5 `peers` lists today)."""
        conns = {c.agent_id for c in db.scalars(select(ConnectionRow).where(ConnectionRow.active))}
        rows = db.scalars(select(AgentRow).where(AgentRow.id.in_(conns)))
        return {r.id: r.url for r in rows if r.url}

    @app.get("/runtime/acl/{agent_id}")
    def runtime_acl(agent_id: str, db: DB, _: auth.caller) -> dict[str, list[str]]:
        """Which connected agents the user allowed to read which of `agent_id`'s context fields
        (`context:<agent_id>.<field>` permissions): the plugin's `fieldAcl`, from the Hub."""
        acl: dict[str, list[str]] = {}
        for c in db.scalars(select(ConnectionRow).where(ConnectionRow.active)):
            for p in c.permissions:
                if p.startswith(f"context:{agent_id}."):
                    acl.setdefault(c.agent_id, []).append(p.split(".", 1)[1])
        return acl

    @app.get("/audit")
    def list_audit(
        db: DB, _: auth.caller, limit: Annotated[int, Query(ge=1, le=500)] = 100
    ) -> list[AuditOut]:
        rows = db.scalars(select(AuditRow).order_by(AuditRow.id.desc()).limit(limit))
        return [_audit_out(r) for r in rows]

    @app.get("/agents/{agent_id}/activity")
    def agent_activity(
        agent_id: str, db: DB, _: auth.caller, limit: Annotated[int, Query(ge=1, le=100)] = 20
    ) -> AgentActivity:
        """One agent's history: what the Hub did with it and the requests it handled."""
        if db.get(AgentRow, agent_id) is None:
            raise _problem(404, "UNKNOWN_AGENT", f"no agent {agent_id!r}")
        rows = db.scalars(
            select(AuditRow)
            .where(AuditRow.agent_id == agent_id)
            .order_by(AuditRow.id.desc())
            .limit(limit)
        )
        flows, state = [], "not configured (HUB_COLLECTOR_URL)"
        if collector is not None:
            try:
                r = collector.get("/flows", params={"limit": 100})  # the Collector's page cap
                r.raise_for_status()
                flows = [f for f in r.json() if agent_id in f.get("agents", [])][:limit]
                state = "ok"
            except (httpx.HTTPError, ValueError, TypeError, AttributeError) as e:
                state = f"unreachable: {e.__class__.__name__}"
        return AgentActivity(
            agent_id=agent_id, hub=[_audit_out(r) for r in rows], flows=flows, collector=state
        )

    return app


def _audit_out(r: AuditRow) -> AuditOut:
    return AuditOut(
        ts=r.ts,
        actor=r.actor,
        action=r.action,
        agent_id=r.agent_id,
        connection_id=r.connection_id,
        detail=r.detail,
    )


def _slug(name: str) -> str:
    out = "".join(ch if ch.isascii() and ch.isalnum() else "-" for ch in name.lower())
    return "-".join(p for p in out.split("-") if p)[:64]


def build() -> FastAPI:
    """App for `uvicorn agenthub.main:build --factory` (config files + environment)."""
    return create_app(
        load_config(),
        database_url("hub"),
        agents_host=os.environ.get("HUB_AGENTS_HOST") or None,
        collector_url=os.environ.get("HUB_COLLECTOR_URL", "http://127.0.0.1:8200") or None,
    )
