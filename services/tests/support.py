"""Shared test values: the environment the services would get from the root .env."""

ENV = {
    "AGENT_TOKEN_DESKTOP": "t-desktop",
    "AGENT_TOKEN_SMARTPHONE": "t-smartphone",
    "AGENT_TOKEN_ROOT": "t-root",
    "AGENT_TOKEN_ROOM1": "t-room1",
    "AGENT_TOKEN_ROOM2": "t-room2",
    "AGENT_TOKEN_KITCHEN": "t-kitchen",
    "DASHBOARD_TOKEN": "t-dashboard",
    "HOME_USER_TOKEN": "t-user",
    "STUDIO_TOKEN": "t-studio",
    "RUNTIME_TOKEN": "t-runtime",
}


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


ROOM1 = bearer("t-room1")
ROOM2 = bearer("t-room2")
HOME = bearer("t-root")
DESKTOP = bearer("t-desktop")
DASHBOARD = bearer("t-dashboard")
USER = bearer("t-user")
STUDIO = bearer("t-studio")
RUNTIME = bearer("t-runtime")
