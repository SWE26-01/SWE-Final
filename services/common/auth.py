"""Bearer-token callers (config/agents.yaml) as FastAPI dependencies."""

# No `from __future__ import annotations`: FastAPI must read the dependency annotations below
# at runtime, and they refer to local functions.
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from homeconfig import HomeConfig
from homeconfig.models import Caller, Role

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Auth:
    """`Annotated` types for route parameters. Modules that use them in signatures must not
    use `from __future__ import annotations` (FastAPI reads the annotations at runtime)."""

    caller: Any  # any known token
    agent: Any  # agents only
    operator: Any  # operators only
    simulator: Any  # simulators only
    dashboard: Any  # operators or simulators (screens, never agents)


def make_auth(config: HomeConfig) -> Auth:
    def caller(cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]) -> Caller:
        found = config.caller_by_token(cred.credentials) if cred else None
        if found is None:
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "missing or unknown bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return found

    def role(*allowed: Role):
        def check(found: Annotated[Caller, Depends(caller)]) -> Caller:
            if found.role not in allowed:
                raise HTTPException(status.HTTP_403_FORBIDDEN, f"{' or '.join(allowed)} only")
            return found

        return check

    return Auth(
        caller=Annotated[Caller, Depends(caller)],
        agent=Annotated[Caller, Depends(role(Role.AGENT))],
        operator=Annotated[Caller, Depends(role(Role.OPERATOR))],
        simulator=Annotated[Caller, Depends(role(Role.SIMULATOR))],
        dashboard=Annotated[Caller, Depends(role(Role.OPERATOR, Role.SIMULATOR))],
    )


def ws_caller(config: HomeConfig, token: str | None, *roles: Role) -> Caller | None:
    """Caller for a WebSocket. Browsers cannot set headers on one, so the token comes in the
    query string. None if the token is unknown or the role is not one of `roles`."""
    found = config.caller_by_token(token) if token else None
    return found if found is not None and found.role in roles else None
