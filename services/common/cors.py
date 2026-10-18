"""Let dashboards in a browser read the services directly (without a dev-server proxy)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from homeconfig import HomeConfig


def allow_dashboards(app: FastAPI, config: HomeConfig) -> None:
    """Allow GET from `config.cors_origins` (env AMBIENT_CORS_ORIGINS); nothing when it is empty.
    WebSockets are not subject to CORS. Commands and event reports never come from a browser."""
    if config.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=config.cors_origins,
            allow_methods=["GET"],
            allow_headers=["Authorization"],
        )
