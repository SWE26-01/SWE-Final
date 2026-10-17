"""Send Ambient-A2A messages to other agents by id."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import httpx
from a2a.client import Client, ClientCallContext, ClientConfig, create_client
from a2a.client.service_parameters import ServiceParametersFactory, with_a2a_extensions
from a2a.types.a2a_pb2 import SendMessageRequest, TaskState
from pydantic import BaseModel

from ambient.a2a_codec import AMBIENT_EXT_URI, from_parts, to_message
from ambient.schemas import AmbientMessage
from homeconfig import HomeConfig
from homeconfig.models import Agent

HttpClientFactory = Callable[[Agent], httpx.AsyncClient]


@dataclass(frozen=True)
class SendResult:
    state: str  # e.g. "TASK_STATE_COMPLETED", "TASK_STATE_REJECTED"; "MESSAGE" if no Task
    reply: AmbientMessage | None
    task_id: str | None = None

    @property
    def ok(self) -> bool:
        return self.state == "TASK_STATE_COMPLETED"


class AgentClient:
    """One per agent process. Reuses an A2A client per target agent."""

    def __init__(
        self,
        config: HomeConfig,
        self_id: str,
        http_client_factory: HttpClientFactory | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._config = config
        self._self_id = self_id
        self._timeout = timeout
        self._http_factory = http_client_factory or (lambda _: httpx.AsyncClient(timeout=timeout))
        self._clients: dict[str, tuple[Client, httpx.AsyncClient]] = {}

    async def send(self, target_id: str, msg: BaseModel) -> SendResult:
        client = await self._client(target_id)
        params = ServiceParametersFactory.create([with_a2a_extensions([AMBIENT_EXT_URI])])
        ctx = ClientCallContext(service_parameters=params, timeout=self._timeout)

        request = SendMessageRequest(message=to_message(msg))
        last = None
        async for event in client.send_message(request, context=ctx):
            last = event
        if last is None:
            raise RuntimeError(f"no response from {target_id}")
        if last.HasField("message"):
            return SendResult(state="MESSAGE", reply=from_parts(last.message.parts))

        task = last.task
        reply = from_parts(task.artifacts[-1].parts) if task.artifacts else None
        return SendResult(state=TaskState.Name(task.status.state), reply=reply, task_id=task.id)

    async def _client(self, target_id: str) -> Client:
        if target_id not in self._clients:
            target = self._config.agent(target_id)
            if target.url is None:
                raise ValueError(f"{target_id} has no url")
            http = self._http_factory(target)
            client = await create_client(
                target.url, client_config=ClientConfig(streaming=False, httpx_client=http)
            )
            self._clients[target_id] = (client, http)
        return self._clients[target_id][0]

    async def close(self) -> None:
        for client, http in self._clients.values():
            await client.close()
            await http.aclose()
        self._clients.clear()

    async def __aenter__(self) -> AgentClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()
