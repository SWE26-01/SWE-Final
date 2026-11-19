"""The virtual home: the state of every device in config/devices.yaml, kept by the Gateway.

There is no real hardware and no Home Assistant. Devices start in their initial state
(`Device.initial`) and change only through `call()`, which the Gateway runs after its ownership
check. States are in memory: restarting the Gateway resets the home. State objects use Home
Assistant's shape, so agents keep calling the Gateway like the HA REST API.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from homeconfig import HomeConfig

State = dict[str, Any]  # {entity_id, state, attributes, last_changed, last_updated}


@dataclass(frozen=True)
class Change:
    state: State
    previous: str


class BadValue(Exception):
    pass


def _now() -> str:
    return datetime.now(UTC).isoformat()


class VirtualHome:
    def __init__(self, config: HomeConfig) -> None:
        self._states: dict[str, State] = {}
        at = _now()
        for entity, device in config.devices.items():
            attributes: dict[str, Any] = {"friendly_name": device.name or entity}
            if device.options:
                attributes["options"] = list(device.options)
            self._states[entity] = {
                "entity_id": entity,
                "state": device.initial,
                "attributes": attributes,
                "last_changed": at,
                "last_updated": at,
            }

    def get(self, entity: str) -> State | None:
        state = self._states.get(entity)
        return None if state is None else {**state, "attributes": dict(state["attributes"])}

    def call(self, service: str, entity: str, data: dict[str, Any]) -> Change:
        """Run one checked service call (gateway.main.SERVICES) on one device."""
        current = self._states[entity]
        previous = current["state"]
        if service == "turn_on":
            new = "on"
        elif service == "turn_off":
            new = "off"
        elif service == "toggle":
            new = "off" if previous == "on" else "on"
        elif service == "select_option":
            new = str(data["option"])
            if new not in current["attributes"].get("options", []):
                raise BadValue(f"{new!r} is not an option of {entity}")
        elif service == "set_value":
            try:
                new = str(float(data["value"]))
            except (TypeError, ValueError):
                raise BadValue(f"{data['value']!r} is not a number") from None
        else:
            raise BadValue(f"unknown service {service}")
        at = _now()
        current["last_updated"] = at
        if new != previous:
            current["state"] = new
            current["last_changed"] = at
        return Change(state=self.get(entity) or {}, previous=previous)
