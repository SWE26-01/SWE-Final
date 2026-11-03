"""Messages the Gateway sends to dashboards over WebSocket /ws (contracts/gateway/)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import AwareDatetime, BaseModel, Field


class DeviceState(BaseModel):
    entity: str = Field(description="Home Assistant entity id, from config/devices.yaml")
    space: str
    owner: str = Field(description="the only agent that may command this device")
    state: str | None = Field(description="HA state ('on', '24.0', ...); null if unknown")
    attributes: dict[str, Any] = Field(
        default_factory=dict, description="HA attributes, e.g. friendly_name, options"
    )
    last_changed: AwareDatetime | None = None


class Snapshot(BaseModel):
    """Sent first on connect, and again after the Gateway reconnects to Home Assistant."""

    type: Literal["snapshot"] = "snapshot"
    ha_connected: bool
    devices: list[DeviceState]


class StateChanged(BaseModel):
    type: Literal["device.state_changed"] = "device.state_changed"
    at: AwareDatetime
    device: DeviceState
    previous: str | None = None
