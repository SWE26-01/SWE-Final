"""Agent side of the Event Collector: report events without ever failing the agent."""

from __future__ import annotations

import logging

import httpx

from collector.events import AgentEvent

log = logging.getLogger(__name__)


class EventReporter:
    """One per agent process. `report` logs and swallows every HTTP failure, so an agent keeps
    working when the collector is down; such events are lost, not retried."""

    def __init__(
        self,
        base_url: str,
        token: str,
        timeout: float = 2.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
            transport=transport,
        )

    async def report(self, event: AgentEvent) -> None:
        try:
            resp = await self._http.post(
                "/events",
                content=event.model_dump_json(exclude_none=True),
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
        except httpx.HTTPError as e:
            log.warning("event not recorded (%s from %s): %r", event.kind, event.agent, e)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> EventReporter:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()
