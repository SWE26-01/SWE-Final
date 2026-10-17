"""Start any agent from config alone.

    python -m agents.run my-room-user1 [--config config/]

The agent's `kind` selects `agents/<kind>/app.py`, which must define
`build_router(config, agent) -> Router`. Until that module exists the agent
starts with no handlers (it serves its card and rejects every message).
"""

from __future__ import annotations

import argparse
import importlib
from urllib.parse import urlparse

import uvicorn
from fastapi import FastAPI

from agents.common.router import Router
from agents.common.server import create_agent_app
from homeconfig import HomeConfig, load_config


def build_router(config: HomeConfig, agent_id: str) -> Router:
    agent = config.agent(agent_id)
    module_name = f"agents.{agent.kind}.app"
    try:
        module = importlib.import_module(module_name)
    except ModuleNotFoundError as e:
        if e.name != module_name:
            raise
        return Router()
    return module.build_router(config, agent)


def build_app(config: HomeConfig, agent_id: str) -> FastAPI:
    return create_agent_app(config, agent_id, build_router(config, agent_id))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("agent_id")
    parser.add_argument("--config", default=None, help="config directory (default: ./config)")
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    config = load_config(args.config)
    agent = config.agent(args.agent_id)
    if not agent.enabled:
        parser.error(f"{args.agent_id} is disabled in agents.yaml")
    port = urlparse(agent.url).port if agent.url else None
    if port is None:
        parser.error(f"{args.agent_id} has no port in its url")
    uvicorn.run(build_app(config, args.agent_id), host=args.host, port=port)


if __name__ == "__main__":
    main()
