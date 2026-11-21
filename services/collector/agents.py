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

from common.agentcard import card_tags
from common.hublink import HubDown, HubLink
from homeconfig.loader import _on_host as on_host
from homeconfig.models import Caller, Role

log = logging.getLogger(__name__)

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
    tags = card_tags(card)
    return AgentStatus(
        id=agent_id,
        online=True,
        checked_at=checked_at,
        role=tags.role,
        space=tags.space,
        owned_devices=tags.owned_devices,
        provided_fields=tags.provided_fields,
    )


class AgentWatcher:
    """Checks every agent's card and calls `on_change()` when anyone goes up or down or changes.
    With `hub`, the agents the user connected in the Agent Hub (Studio-made ones ...) are watched
    too, for as long as they stay connected."""

    def __init__(
        self,
        agents: list[Caller],
        on_change: Callable[[], None],
        transport: httpx.AsyncBaseTransport | None = None,
        interval: float = CHECK_EVERY,
        timeout: float = 2.0,
        hub: HubLink | None = None,
        agents_host: str | None = None,
    ) -> None:
        self._agents = [a for a in agents if a.url]
        self._fixed = {a.id for a in agents}
        self._hub = hub
        self._agents_host = agents_host
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

    async def _follow_hub(self) -> bool:
        """Add agents newly connected in the Hub, drop the disconnected ones. True if any did."""
        try:
            peers = await self._hub.peers() if self._hub else None
        except HubDown as e:
            log.debug("hub: %s", e)
            return False
        if peers is None:
            return False
        extra = {i: on_host(u, self._agents_host) for i, u in peers.items() if i not in self._fixed}
        before = {a.id for a in self._agents} - self._fixed
        self._agents = [a for a in self._agents if a.id in self._fixed or a.id in extra]
        for agent_id in before - set(extra):
            self.statuses.pop(agent_id, None)
        for agent_id, url in extra.items():
            if agent_id not in before:
                self._agents.append(Caller(id=agent_id, role=Role.AGENT, token="", url=url))
                self.statuses[agent_id] = AgentStatus(id=agent_id, online=False)
        return before != set(extra)

    async def check_once(self) -> bool:
        """Check all agents; True if anything other than the check time changed."""
        changed = await self._follow_hub()
        results = await asyncio.gather(*(self._check(a) for a in self._agents))
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
