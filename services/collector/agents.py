"""Which agents are up: the Collector reads each agent's Agent Card every few seconds.

Dashboards get the result in the WebSocket snapshot, as `{"type": "agents"}` messages when something
changes, and from GET /agents. Browsers never call the agents themselves.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx
from pydantic import AwareDatetime, BaseModel, Field

from homeconfig.models import Caller

log = logging.getLogger(__name__)

EXT_PREFIX = "https://github.com/nsu102/A2A-agents/spec/ambient-a2a/"
CHECK_EVERY = 5.0  # seconds between card checks


class AgentStatus(BaseModel):
    id: str
    online: bool = Field(description="its Agent Card answered at the last check")
    checked_at: AwareDatetime | None = Field(
        default=None, description="last check; null before the first"
    )
    role: str | None = Field(default=None, description="external, home or room (from the card)")
    space: str | None = None
    owned_devices: list[str] = Field(default_factory=list)
    provided_fields: list[str] = Field(default_factory=list)
    last_event_at: AwareDatetime | None = Field(
        default=None, description="`ts` of its latest event in the Collector"
    )
    events: int = Field(default=0, description="events it has reported")


def from_card(agent_id: str, card: dict[str, Any], checked_at: datetime) -> AgentStatus:
    extensions = card.get("capabilities", {}).get("extensions", [])
    ext = next((e for e in extensions if str(e.get("uri", "")).startswith(EXT_PREFIX)), {})
    params = ext.get("params") or {}
    return AgentStatus(
        id=agent_id,
        online=True,
        checked_at=checked_at,
        role=params.get("role"),
        space=params.get("space"),
        owned_devices=params.get("owned_devices") or [],
        provided_fields=params.get("provided_fields") or [],
    )


class AgentWatcher:
    """Checks every agent's card and calls `on_change()` when anyone goes up or down or changes."""

    def __init__(
        self,
        agents: list[Caller],
        on_change: Callable[[], None],
        transport: httpx.AsyncBaseTransport | None = None,
        interval: float = CHECK_EVERY,
        timeout: float = 2.0,
    ) -> None:
        self._agents = [a for a in agents if a.url]
        self._on_change = on_change
        self._interval = interval
        self._http = httpx.AsyncClient(timeout=timeout, transport=transport)
        self.statuses = {a.id: AgentStatus(id=a.id, online=False) for a in agents}

    async def _check(self, agent: Caller) -> AgentStatus:
        now = datetime.now(UTC)
        try:
            resp = await self._http.get(f"{agent.url}/.well-known/agent-card.json")
            resp.raise_for_status()
            return from_card(agent.id, resp.json(), now)
        except (httpx.HTTPError, ValueError) as e:
            log.debug("agent %s is down: %r", agent.id, e)
            last = self.statuses[agent.id]
            return last.model_copy(update={"online": False, "checked_at": now})

    async def check_once(self) -> bool:
        """Check all agents; True if anything other than the check time changed."""
        results = await asyncio.gather(*(self._check(a) for a in self._agents))
        changed = False
        for status in results:
            before = self.statuses[status.id].model_dump(exclude={"checked_at"})
            changed |= before != status.model_dump(exclude={"checked_at"})
            self.statuses[status.id] = status
        return changed

    async def run(self) -> None:
        try:
            while True:
                if await self.check_once():
                    self._on_change()
                await asyncio.sleep(self._interval)
        finally:
            await self._http.aclose()
