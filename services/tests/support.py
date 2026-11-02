"""Shared test values: the environment the services would get from the root .env."""

ENV = {
    "AMBIENT_TOKEN_DESKTOP": "t-desktop",
    "AMBIENT_TOKEN_SMARTPHONE": "t-smartphone",
    "AMBIENT_TOKEN_ORCHESTRATOR": "t-orchestrator",
    "AMBIENT_TOKEN_ROOM1": "t-room1",
    "AMBIENT_TOKEN_ROOM2": "t-room2",
    "DASHBOARD_TOKEN": "t-dashboard",
    "SIMULATOR_TOKEN": "t-simulator",
    "HA_URL": "http://ha.test:8123",
    "HA_TOKEN": "t-ha",
}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


ROOM1 = bearer("t-room1")
ROOM2 = bearer("t-room2")
HOME = bearer("t-orchestrator")
DESKTOP = bearer("t-desktop")
DASHBOARD = bearer("t-dashboard")
SIMULATOR = bearer("t-simulator")
