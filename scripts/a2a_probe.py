"""Standard a2a-sdk client for Ambient-A2A agents (interop check + negative tests).

  python scripts/a2a_probe.py cards
  python scripts/a2a_probe.py send <target> <as-agent|bad> '<json DataPart>'

<as-agent> picks AMBIENT_TOKEN_<AS> from the environment (scripts/oc.sh-style .env); "bad" sends a bogus token.
"""

import asyncio
import json
import os
import sys
import uuid

import httpx
from a2a.client import ClientConfig, create_client
from a2a.client.card_resolver import A2ACardResolver
from a2a.types import Message, Part, Role, SendMessageRequest
from google.protobuf.json_format import MessageToDict, ParseDict

EXT_URI = "https://github.com/nsu102/A2A-agents/spec/ambient-a2a/v1"
PORTS = {"desktop": 18800, "smartphone": 18920, "orchestrator": 19040, "room1": 19160, "room2": 19280}
url = lambda agent: f"http://127.0.0.1:{PORTS[agent]}/plugins/ambient"


async def cards():
    async with httpx.AsyncClient() as http:
        for agent in PORTS:
            try:
                card = await A2ACardResolver(http, url(agent)).get_agent_card()
            except Exception as e:  # noqa: BLE001 - report and continue
                print(f"{agent:12} DOWN ({e.__class__.__name__})")
                continue
            ext = next((e for e in card.capabilities.extensions if e.uri == EXT_URI), None)
            params = MessageToDict(ext.params) if ext else None
            print(f"{agent:12} {card.supported_interfaces[0].url}  ambient={'yes' if ext else 'NO'}  {json.dumps(params, ensure_ascii=False)}")


async def send(target: str, as_agent: str, data: dict):
    token = "bad-token" if as_agent == "bad" else os.environ[f"AMBIENT_TOKEN_{as_agent.upper()}"]
    data.setdefault("requester", as_agent)
    async with httpx.AsyncClient(headers={"Authorization": f"Bearer {token}", "A2A-Extensions": EXT_URI}, timeout=30) as http:
        client = await create_client(url(target), client_config=ClientConfig(streaming=False, httpx_client=http))
        msg = Message(message_id=str(uuid.uuid4()), role=Role.ROLE_USER, parts=[ParseDict({"data": data}, Part())])
        async for resp in client.send_message(SendMessageRequest(message=msg)):
            task = MessageToDict(resp).get("task", {})
            result = task.get("artifacts", [{}])[0].get("parts", [{}])[0].get("data")
            print(task.get("status", {}).get("state"), json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    cmd, *args = sys.argv[1:] or ["cards"]
    asyncio.run(cards() if cmd == "cards" else send(args[0], args[1], json.loads(args[2])))
