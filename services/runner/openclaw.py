"""Talking to an agent's LLM: the OpenClaw gateway's OpenAI-compatible chat endpoint.

Every agent runs its own OpenClaw gateway; the plugin's A2A base URL in config/agents.yaml
(`http://host:port/plugins/ambient`) shares that gateway's origin. The endpoint is off by default
and must be enabled per gateway (`gateway.http.endpoints.chatCompletions.enabled: true`).
Only the Runner holds the gateway token (env OPENCLAW_GATEWAY_TOKEN).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

from homeconfig.models import Caller

log = logging.getLogger(__name__)

MODEL = "openclaw/main"  # each agent profile's own `main` agent (scripts/oc.sh ... --agent main)
REPLY_TIMEOUT = 180.0  # seconds; one LLM turn with tool calls takes ~10-20 s


class AgentError(Exception):
    """The agent gave no reply. The message says why, for the screen."""


@dataclass(frozen=True)
class Reply:
    text: str
    tokens: int | None


def chat_url(agent_url: str) -> str:
    """http://127.0.0.1:18800/plugins/ambient -> http://127.0.0.1:18800/v1/chat/completions"""
    parts = urlsplit(agent_url)
    return urlunsplit((parts.scheme, parts.netloc, "/v1/chat/completions", "", ""))


class OpenClaw:
    def __init__(
        self,
        token: str,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = REPLY_TIMEOUT,
    ) -> None:
        self._timeout = timeout
        self._http = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {token}"},
            timeout=httpx.Timeout(timeout, connect=5.0),
            transport=transport,
        )

    async def say(self, agent: Caller, text: str, session: str) -> Reply:
        """Send one user message and wait for the agent's final answer. The same `session`
        continues one conversation with that agent."""
        if not agent.url:
            raise AgentError(f"{agent.id} has no URL in config/agents.yaml")
        body = {"model": MODEL, "user": session, "messages": [{"role": "user", "content": text}]}
        try:
            resp = await self._http.post(chat_url(agent.url), json=body)
        except httpx.TimeoutException as e:
            raise AgentError(f"{agent.id} did not answer within {self._timeout:.0f} s") from e
        except httpx.HTTPError as e:
            log.warning("OpenClaw %s unreachable: %r", agent.id, e)
            raise AgentError(f"{agent.id} is not reachable (is the agent running?)") from e
        if resp.status_code == 404:
            raise AgentError(
                f"{agent.id}: the OpenClaw chat endpoint is off "
                "(gateway.http.endpoints.chatCompletions.enabled)"
            )
        if resp.status_code in (401, 403):
            raise AgentError(f"{agent.id}: OpenClaw rejected OPENCLAW_GATEWAY_TOKEN")
        if resp.status_code != 200:
            detail = _detail(resp)
            raise AgentError(f"{agent.id}: OpenClaw answered HTTP {resp.status_code}: {detail}")
        return _reply(agent.id, resp)

    async def aclose(self) -> None:
        await self._http.aclose()


def _detail(resp: httpx.Response) -> str:
    try:
        error = resp.json().get("error", {})
        message = error.get("message") if isinstance(error, dict) else error
    except (ValueError, AttributeError):
        message = None
    return str(message or resp.text)[:200]


def _reply(agent_id: str, resp: httpx.Response) -> Reply:
    try:
        body: dict[str, Any] = resp.json()
        text = body["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as e:
        raise AgentError(f"{agent_id}: unexpected answer from OpenClaw") from e
    if not isinstance(text, str) or not text.strip():
        raise AgentError(f"{agent_id}: empty reply")
    tokens = (body.get("usage") or {}).get("total_tokens")
    return Reply(text=text, tokens=tokens if isinstance(tokens, int) else None)
