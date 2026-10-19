"""What the Runner reports to dashboards: runs and their steps (contracts/runner/).

GET /runs and GET /runs/{id} return `Run`; WebSocket /ws sends a `RunsSnapshot` on connect and a
`RunUpdated` with the whole run after every change, so a screen just replaces what it has.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import AwareDatetime, BaseModel, Field

REPLY_LIMIT = 4000  # characters of an agent's reply that are kept


class RunStatus(StrEnum):
    RUNNING = "running"
    DONE = "done"  # every step got a reply (what the agents decided is in the replies and events)
    FAILED = "failed"  # a step got no reply; the steps after it were skipped


class StepStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"


class StepState(BaseModel):
    agent: str
    say: str = Field(description="what was said to the agent")
    setup: bool = Field(description="prepares the home for the scenario")
    status: StepStatus = StepStatus.PENDING
    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None
    reply: str | None = Field(default=None, description="the agent's LLM answer (final text)")
    tokens: int | None = Field(default=None, description="LLM tokens the step used, if reported")
    error: str | None = Field(default=None, description="why the step got no reply")


class Run(BaseModel):
    id: str
    scenario: str | None = Field(description="scenario id; null for free text")
    title: str
    status: RunStatus = RunStatus.RUNNING
    started_at: AwareDatetime = Field(
        description="agent events (Collector) from this time on belong to the run"
    )
    ended_at: AwareDatetime | None = None
    steps: list[StepState]
    expect: dict[str, str] = Field(
        default_factory=dict, description="device states the scenario expects afterwards"
    )


class RunsSnapshot(BaseModel):
    """Sent first on connect: recent runs, newest first (the running one, if any, is first)."""

    type: Literal["snapshot"] = "snapshot"
    runs: list[Run]


class RunUpdated(BaseModel):
    """Sent after every change of a run."""

    type: Literal["run.updated"] = "run.updated"
    run: Run
