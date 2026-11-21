"""The Hub's connections as the runtime sees them: which Hub-issued token belongs to which connected
agent, and who owns each device now.

The Gateway and the Event Collector use it when `<SERVICE>_HUB_URL` is set, with the `runtime`
service token (config/agents.yaml). Answers are cached for a few seconds, so a disconnect takes
effect within `ttl`. When the Hub cannot be reached, HubDown is raised and the caller refuses: a
device never falls back to config/devices.yaml owners once the Hub is in charge.
"""

# No `from __future__ import annotations`: FastAPI reads the dependency annotations below.
import time
from typing import Annotated, Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from homeconfig import HomeConfig
from homeconfig.models import Caller, Role

RUNTIME = "runtime"  # the service caller that may ask the Hub (config/agents.yaml `services`)
_bearer = HTTPBearer(auto_error=False)


class HubDown(Exception):
    pass


class HubLink:
    def __init__(
        self,
        url: str,
        token: str,
        *,
        ttl: float = 3.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=3,
            transport=transport,
        )
        self._ttl = ttl
        self._cache: dict[str, tuple[float, Any]] = {}

    async def _cached(self, key: str, fetch) -> Any:
        hit = self._cache.get(key)
        if hit is not None and time.monotonic() - hit[0] < self._ttl:
            return hit[1]
        try:
            value = await fetch()
        except (httpx.HTTPError, ValueError) as e:
            raise HubDown(f"Hub unreachable: {e.__class__.__name__}") from e
        self._cache[key] = (time.monotonic(), value)
        return value

    async def _get(self, path: str) -> Any:
        r = await self._http.get(path)
        r.raise_for_status()
        return r.json()

    async def verify(self, token: str) -> str | None:
        """Agent id of an active Hub-issued token, else None."""

        async def fetch() -> str | None:
            r = await self._http.post("/tokens/verify", json={"token": token})
            r.raise_for_status()
            body = r.json()
            return body.get("agent_id") if body.get("active") else None

        return await self._cached(f"verify:{token}", fetch)

    async def owners(self) -> dict[str, str | None]:
        """Device -> the agent connected as its owner now (None: nobody)."""
        return await self._cached("ownership", lambda: self._get("/ownership"))

    async def peers(self) -> dict[str, str]:
        """Connected agent -> its A2A base URL."""
        return await self._cached("peers", lambda: self._get("/runtime/peers"))

    async def aclose(self) -> None:
        await self._http.aclose()


def hub_link(config: HomeConfig, url: str | None, **kw: Any) -> HubLink | None:
    """A HubLink with the runtime token, or None when `url` is empty (Hub checks off)."""
    if not url:
        return None
    runtime = config.callers.get(RUNTIME)
    if runtime is None:
        raise ValueError(f"a Hub URL is set but the {RUNTIME!r} service token is missing")
    return HubLink(url, runtime.token, **kw)


def agent_auth(config: HomeConfig, hub: HubLink | None, *, readers: bool = False):
    """Dependency type for routes agents call: a config agent, or an agent connected in the Hub
    (its Hub-issued token). With `readers`, every config caller (operators ...) passes too."""

    async def caller(
        cred: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    ) -> Caller:
        token = cred.credentials if cred else ""
        found = config.caller_by_token(token) if token else None
        if found is not None and (readers or found.role is Role.AGENT):
            return found
        if found is None and token and hub is not None:
            try:
                agent_id = await hub.verify(token)
            except HubDown as e:
                raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(e)) from e
            if agent_id:
                return Caller(id=agent_id, role=Role.AGENT, token=token)
        if found is not None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "agent only")
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "missing or unknown bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return Annotated[Caller, Depends(caller)]
