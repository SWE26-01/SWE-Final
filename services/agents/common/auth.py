"""Bearer-token authentication for agent servers (WBS W2-2).

Authentication happens at the HTTP layer, before the A2A request handler, so it also
covers GetTask / CancelTask / SubscribeToTask — methods that never reach the
AgentExecutor (see docs/HANDOFF.md). The authenticated agent id becomes
`request.user`, which the SDK uses as the Task owner: a caller only sees its own Tasks.
"""

from __future__ import annotations

import json

from starlette.authentication import AuthCredentials, SimpleUser
from starlette.types import ASGIApp, Receive, Scope, Send

from homeconfig import HomeConfig
from homeconfig.models import AgentRole

PUBLIC_PATHS = frozenset({"/.well-known/agent-card.json", "/health"})


class BearerAuthMiddleware:
    """Require `Authorization: Bearer <agent token>` on every non-public HTTP request."""

    def __init__(self, app: ASGIApp, config: HomeConfig) -> None:
        self.app = app
        self.config = config

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in PUBLIC_PATHS:
            await self.app(scope, receive, send)
            return

        headers = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        scheme, _, token = headers.get("authorization", "").partition(" ")
        agent = self.config.agent_by_token(token) if scheme.lower() == "bearer" else None
        if agent is None or not agent.enabled:
            await _deny(send, 401, "missing or invalid bearer token")
            return
        if agent.role is not AgentRole.AGENT:
            await _deny(send, 403, f"{agent.id} may not call agents")
            return

        scope["user"] = SimpleUser(agent.id)
        scope["auth"] = AuthCredentials([agent.role.value])
        await self.app(scope, receive, send)


async def _deny(send: Send, status: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"www-authenticate", b"Bearer"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
