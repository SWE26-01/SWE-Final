"""In-memory device and space state of the virtual Device Gateway (WBS W8-1).

Pure state and rules, no HTTP. Ownership and roles are checked by the routes in gateway.main.
State values are strings, matching config/devices.yaml (`power: "on"`).
"""

from __future__ import annotations

import copy
import re
from collections.abc import Callable
from typing import Annotated, Any, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictStr,
    model_validator,
)

from homeconfig import HomeConfig

OUTSIDE = "outside"
LIGHT_MODES = ("normal", "meeting", "saving", "sleep")
SPACE_DEFAULTS: dict[str, Any] = {
    "occupied": False,
    "temperature": "26",
    "illuminance": "300",
    "sleeping": False,
}


class GatewayError(Exception):
    """Request rejected; `status_code` is the HTTP status the Gateway answers with."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# --- device commands ----------------------------------------------------------

# (current state, params) -> fields to update
Handler = Callable[[dict[str, str], dict[str, Any]], dict[str, str]]


def _params(params: dict[str, Any], *names: str) -> list[Any]:
    """Return the values of exactly `names`; 400 on missing or unexpected keys."""
    extra = sorted(set(params) - set(names))
    if extra:
        raise GatewayError(400, f"unexpected params: {extra}")
    missing = [n for n in names if n not in params]
    if missing:
        raise GatewayError(400, f"missing params: {missing}")
    return [params[n] for n in names]


def _set(field: str, value: str) -> Handler:
    def handle(state: dict[str, str], params: dict[str, Any]) -> dict[str, str]:
        _params(params)
        return {field: value}

    return handle


def _set_mode(state: dict[str, str], params: dict[str, Any]) -> dict[str, str]:
    (mode,) = _params(params, "mode")
    if mode not in LIGHT_MODES:
        raise GatewayError(400, f"params.mode must be one of {list(LIGHT_MODES)}")
    return {"mode": mode}


def _set_temp(state: dict[str, str], params: dict[str, Any]) -> dict[str, str]:
    (temp,) = _params(params, "target_temp")
    if not isinstance(temp, str) or not re.fullmatch(r"[0-9]+", temp):
        raise GatewayError(400, 'params.target_temp must be a digit string, e.g. "24"')
    return {"target_temp": temp}


def _vacuum(status: str, only_from: str | None = None) -> Handler:
    def handle(state: dict[str, str], params: dict[str, Any]) -> dict[str, str]:
        _params(params)
        current = state.get("status", "idle")
        if only_from is not None and current != only_from:
            raise GatewayError(409, f"vacuum is {current!r}; this command needs {only_from!r}")
        return {"status": status}

    return handle


_POWER = {"TURN_ON": _set("power", "on"), "TURN_OFF": _set("power", "off")}

COMMANDS: dict[str, dict[str, Handler]] = {
    "light": {**_POWER, "SET_MODE": _set_mode},
    "ac": {**_POWER, "SET_TEMP": _set_temp},
    "tv": dict(_POWER),
    "vacuum": {
        "START": _vacuum("cleaning"),
        "PAUSE": _vacuum("paused", only_from="cleaning"),
        "RESUME": _vacuum("cleaning", only_from="paused"),
        "DOCK": _vacuum("idle"),
    },
}


def apply_command(
    kind: str, state: dict[str, str], command: str, params: dict[str, Any]
) -> dict[str, str]:
    """Device state after `command`. 400 if unsupported or bad params, 409 if not allowed now."""
    handler = COMMANDS.get(kind, {}).get(command)
    if handler is None:
        supported = list(COMMANDS.get(kind, {}))
        raise GatewayError(400, f"{kind} does not support {command!r} (supported: {supported})")
    return {**state, **handler(state, params)}


# --- inputs (POST /inputs, contracts/gateway/events.schema.json) ---------------


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PersonMoved(_Input):
    type: Literal["person.moved"]
    at: AwareDatetime
    person: str
    space: str  # space id or "outside"


class SensorChanged(_Input):
    type: Literal["sensor.changed"]
    at: AwareDatetime
    space: str
    sensor: Literal["occupied", "temperature", "illuminance"]
    value: StrictStr | StrictBool

    @model_validator(mode="after")
    def _value_type(self) -> SensorChanged:
        want = bool if self.sensor == "occupied" else str
        if not isinstance(self.value, want):
            raise ValueError(f"{self.sensor} value must be a {want.__name__}")
        return self


InputEvent = Annotated[PersonMoved | SensorChanged, Field(discriminator="type")]


# --- state ----------------------------------------------------------------------


class GatewayState:
    """Device and space state plus command dedupe. Use from a single event loop."""

    def __init__(self, config: HomeConfig) -> None:
        self.config = config
        self.devices: dict[str, dict[str, str]] = {
            d.id: dict(d.state) for d in config.devices.values()
        }
        self.spaces: dict[str, dict[str, Any]] = {
            s: {**SPACE_DEFAULTS, "people": []} for s in config.spaces
        }
        # (caller, request_id) -> ((device, command, params), response)
        self._done: dict[tuple[str, str], tuple[tuple[str, str, dict[str, Any]], dict]] = {}

    def device_view(self, device_id: str) -> dict[str, Any]:
        d = self.config.devices[device_id]
        state = dict(self.devices[device_id])
        return {"id": d.id, "space": d.space, "kind": d.kind, "owner": d.owner, "state": state}

    def device_views(self) -> list[dict[str, Any]]:
        return [self.device_view(d) for d in self.devices]

    def space_state(self, space_id: str) -> dict[str, Any]:
        return copy.deepcopy(self.spaces[space_id])

    def space_view(self, space_id: str) -> dict[str, Any]:
        return {"id": space_id, **self.space_state(space_id)}

    def snapshot(self) -> dict[str, Any]:
        spaces = [self.space_view(s) for s in self.spaces]
        return {"type": "snapshot", "devices": self.device_views(), "spaces": spaces}

    def command(
        self, caller: str, device_id: str, request_id: str, command: str, params: dict[str, Any]
    ) -> tuple[dict[str, Any], bool]:
        """Apply `command` once per (caller, request_id); a repeat returns the stored response.

        Returns (response, changed). `changed` is False for repeats and no-op commands.
        The caller must already have checked that the device exists and `caller` owns it."""
        request = (device_id, command, params)
        done = self._done.get((caller, request_id))
        if done is not None:
            if done[0] != request:
                raise GatewayError(409, f"request_id {request_id!r} was used for another command")
            return copy.deepcopy(done[1]), False

        before = self.devices[device_id]
        after = apply_command(self.config.devices[device_id].kind, before, command, params)
        self.devices[device_id] = after
        response = {"request_id": request_id, "device": device_id, "state": after, "applied": True}
        self._done[(caller, request_id)] = (copy.deepcopy(request), copy.deepcopy(response))
        return copy.deepcopy(response), after != before

    def apply_input(self, event: PersonMoved | SensorChanged) -> list[str]:
        """Apply a scenario or sensor input. Returns the ids of spaces that changed."""
        if isinstance(event, PersonMoved):
            return self._move(event.person, event.space)
        if event.space not in self.spaces:
            raise GatewayError(400, f"unknown space {event.space!r}")
        space = self.spaces[event.space]
        if space[event.sensor] == event.value:
            return []
        space[event.sensor] = event.value
        return [event.space]

    def _move(self, person: str, to: str) -> list[str]:
        if to != OUTSIDE and to not in self.spaces:
            raise GatewayError(400, f"unknown space {to!r} (use a space id or {OUTSIDE!r})")
        frm = next((s for s, v in self.spaces.items() if person in v["people"]), OUTSIDE)
        if frm == to:
            return []
        if frm != OUTSIDE:
            old = self.spaces[frm]
            old["people"].remove(person)
            old["occupied"] = bool(old["people"])
        if to != OUTSIDE:
            new = self.spaces[to]
            new["people"].append(person)
            new["occupied"] = True
        return [s for s in (frm, to) if s != OUTSIDE]
