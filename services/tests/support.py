"""Shared test values: a test home of its own (tests/config) and the environment the services
would get from the root .env."""

from pathlib import Path

CONFIG = Path(__file__).parent / "config"  # `home` owns the devices, `coach` owns none

ENV = {
    "AMBIENT_TOKEN_HOME": "t-home",
    "AMBIENT_TOKEN_COACH": "t-coach",
    "DASHBOARD_TOKEN": "t-dashboard",
    "HA_URL": "http://ha.test:8123",
    "HA_TOKEN": "t-ha",
}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


HOME = bearer("t-home")
COACH = bearer("t-coach")
DASHBOARD = bearer("t-dashboard")
