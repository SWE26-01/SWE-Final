"""Read and check A2A v1.0 Agent Cards: the platform agents' details and external agents' sign-up.

An Agent Card says what an agent offers. It is not a permission: the Hub decides what an agent may
do, and only after the user approves it (main.py `connect`)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from homeconfig.loader import _on_host as on_host  # 127.0.0.1 -> a host a container can reach

EXT_URI = "https://github.com/nsu102/A2A-agents/spec/ambient-a2a/v1"  # ../spec/ambient-a2a.md
CARD_PATH = "/.well-known/agent-card.json"
MAX_CARD_BYTES = 64_000


class CardError(Exception):
    pass


@dataclass(frozen=True)
class CardInfo:
    name: str
    description: str
    base_url: str  # A2A base URL (the JSON-RPC endpoint is <base>/a2a/v1)
    skills: list[str]
    role: str | None = None  # None: a plain A2A agent without the Ambient-A2A extension
    space: str | None = None
    owned_devices: list[str] = field(default_factory=list)
    provided_fields: list[str] = field(default_factory=list)


def card_location(url: str) -> str:
    """Accept a base URL or the card URL itself."""
    url = url.strip().rstrip("/")
    return url if url.endswith(CARD_PATH) else url + CARD_PATH


def fetch_card(client: httpx.Client, url: str, agents_host: str | None = None) -> dict[str, Any]:
    """GET the card. `agents_host` (env HUB_AGENTS_HOST) replaces a loopback host, so a Hub in
    Docker reaches agents that run on the machine (host.docker.internal)."""
    location = card_location(on_host(url.strip(), agents_host) or url)
    if not location.startswith(("http://", "https://")):
        raise CardError("the card URL must start with http:// or https://")
    try:
        r = client.get(location, timeout=5, follow_redirects=False)
    except httpx.HTTPError as e:
        raise CardError(f"cannot fetch {location}: {e.__class__.__name__}") from e
    if r.status_code != 200:
        raise CardError(f"{location} answered {r.status_code}")
    if len(r.content) > MAX_CARD_BYTES:
        raise CardError(f"card is larger than {MAX_CARD_BYTES} bytes")
    try:
        card = r.json()
    except ValueError as e:
        raise CardError("card is not JSON") from e
    if not isinstance(card, dict):
        raise CardError("card is not a JSON object")
    return card


def read_card(card: dict[str, Any]) -> CardInfo:
    """Check the parts the Hub relies on: A2A 1.0 JSON-RPC interface, name, skills, and the
    Ambient-A2A extension if present."""
    name = card.get("name")
    if not isinstance(name, str) or not name.strip():
        raise CardError("card has no name")
    interfaces = card.get("supportedInterfaces")
    if not isinstance(interfaces, list):
        raise CardError("card has no supportedInterfaces (A2A 1.0)")
    endpoint = next(
        (
            i.get("url")
            for i in interfaces
            if isinstance(i, dict) and str(i.get("protocolVersion")) == "1.0" and i.get("url")
        ),
        None,
    )
    if not isinstance(endpoint, str):
        raise CardError("card offers no A2A 1.0 interface")
    skills = [s["id"] for s in card.get("skills") or [] if isinstance(s, dict) and s.get("id")]
    info: dict[str, Any] = {}
    extensions = (card.get("capabilities") or {}).get("extensions") or []
    ext = next((e for e in extensions if isinstance(e, dict) and e.get("uri") == EXT_URI), None)
    if ext is not None:
        params = ext.get("params") or {}
        role = params.get("role")
        info = {
            "role": role if role in ("room", "home", "external") else None,
            "space": params.get("space"),
            "owned_devices": [d for d in params.get("owned_devices") or [] if isinstance(d, str)],
            "provided_fields": [
                f for f in params.get("provided_fields") or [] if isinstance(f, str)
            ],
        }
    return CardInfo(
        name=name.strip()[:80],
        description=str(card.get("description") or "")[:300],
        base_url=endpoint.removesuffix("/a2a/v1"),
        skills=skills,
        **info,
    )
