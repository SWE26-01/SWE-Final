"""Route incoming Ambient-A2A messages to handlers by their `type`."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from pydantic import BaseModel

from ambient.schemas import AmbientMessage, ControlResult


@dataclass(frozen=True)
class HandlerContext:
    agent_id: str
    caller_id: str | None  # authenticated calling agent (BearerAuthMiddleware)
    requested_extensions: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True)
class HandlerResult:
    """What the executor does with a handler's outcome.

    `reply` goes into the Task as a DataPart Artifact. `reject` ends the Task as
    TASK_STATE_REJECTED instead of TASK_STATE_COMPLETED.
    """

    reply: BaseModel | None = None
    reject: bool = False

    @classmethod
    def of(cls, out: HandlerResult | BaseModel | None) -> HandlerResult:
        if isinstance(out, HandlerResult):
            return out
        # A refused device.control ends as REJECTED (plan doc 4.4).
        refused = isinstance(out, ControlResult) and not out.accepted
        return cls(reply=out, reject=refused)


Handler = Callable[[AmbientMessage, HandlerContext], Awaitable[HandlerResult | BaseModel | None]]


@dataclass(frozen=True)
class Route:
    handler: Handler
    description: str


class Router:
    def __init__(self) -> None:
        self._routes: dict[str, Route] = {}

    def on(self, message_type: str, description: str) -> Callable[[Handler], Handler]:
        """Decorator: handle Ambient messages whose `type` is `message_type`."""

        def register(handler: Handler) -> Handler:
            if message_type in self._routes:
                raise ValueError(f"handler for {message_type!r} already registered")
            self._routes[message_type] = Route(handler, description)
            return handler

        return register

    def get(self, message_type: str) -> Route | None:
        return self._routes.get(message_type)

    @property
    def routes(self) -> dict[str, Route]:
        return dict(self._routes)
