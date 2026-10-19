"""Runner (Live Simulation): says scenario steps or free text to the agents' LLMs, one at a time.

The frontend's Live Simulation asks for a run with the simulator token. The Runner then talks to
each agent's OpenClaw gateway (runner/openclaw.py) the way a user would in a chat. What the agents
do arrives through the usual paths: A2A events at the Event Collector, device changes at the Device
Gateway. The Runner never calls Home Assistant or the Gateway and holds no agent token, so it
cannot move a device itself; the agents decide and their policies apply.

Run: uvicorn runner.main:build --factory --port 8300 --env-file ../.env
"""

import asyncio
import contextlib
import logging
import uuid
from collections import deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Annotated, Any

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.websockets import WebSocketDisconnect

from common.auth import make_auth, ws_caller
from common.cors import allow_dashboards
from common.hub import Hub, push
from common.logs import hide_tokens_in_server_logs
from homeconfig import ConfigError, HomeConfig, load_config
from homeconfig.models import SAY_LIMIT, CallerId, Role, Scenario, Step
from runner.openclaw import AgentError, OpenClaw
from runner.stream import (
    REPLY_LIMIT,
    Run,
    RunsSnapshot,
    RunStatus,
    RunUpdated,
    StepState,
    StepStatus,
)

log = logging.getLogger(__name__)

KEEP_RUNS = 20  # finished runs kept in memory for GET /runs and the snapshot


class RunRequest(BaseModel):
    """A scenario from config/scenarios.yaml, or one free-text message to one agent."""

    model_config = ConfigDict(extra="forbid")

    scenario: str | None = None
    agent: CallerId | None = None
    say: Annotated[str, Field(min_length=1, max_length=SAY_LIMIT)] | None = None

    @model_validator(mode="after")
    def _one_kind(self) -> "RunRequest":
        free_text = self.agent is not None or self.say is not None
        if self.scenario is not None and free_text:
            raise ValueError("give either a scenario or an agent and what to say, not both")
        if self.scenario is None and (self.agent is None or self.say is None):
            raise ValueError("give a scenario, or an agent and what to say")
        return self


class Busy(Exception):
    def __init__(self, run_id: str) -> None:
        super().__init__(run_id)
        self.run_id = run_id


def _now() -> datetime:
    return datetime.now(UTC)


class Runs:
    """The running run and the recent ones (memory only), fanned out to dashboards."""

    def __init__(self, config: HomeConfig, openclaw: OpenClaw) -> None:
        self._config = config
        self._openclaw = openclaw
        self._recent: deque[Run] = deque(maxlen=KEEP_RUNS)  # newest first
        self._task: asyncio.Task[None] | None = None
        self.hub = Hub()

    @property
    def running(self) -> Run | None:
        latest = self._recent[0] if self._recent else None
        return latest if latest is not None and latest.status is RunStatus.RUNNING else None

    def recent(self) -> list[Run]:
        return list(self._recent)

    def get(self, run_id: str) -> Run | None:
        return next((r for r in self._recent if r.id == run_id), None)

    def snapshot(self) -> dict[str, Any]:
        return RunsSnapshot(runs=self.recent()).model_dump(mode="json")

    def start(
        self, title: str, scenario: str | None, steps: list[Step], expect: dict[str, str]
    ) -> Run:
        if self.running is not None:
            raise Busy(self.running.id)
        run = Run(
            id=uuid.uuid4().hex[:12],
            scenario=scenario,
            title=title,
            started_at=_now(),
            steps=[StepState(agent=s.agent, say=s.say, setup=s.setup) for s in steps],
            expect=dict(expect),
        )
        self._recent.appendleft(run)
        self._publish(run)
        self._task = asyncio.create_task(self._run(run))
        return run

    async def stop(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def _run(self, run: Run) -> None:
        session = f"simulator-{run.id}"  # one conversation per agent for the whole run
        try:
            for step in run.steps:
                if not await self._step(run, step, session):
                    break
        except Exception:
            log.exception("run %s broke off", run.id)
        finally:  # also when the Runner shuts down mid-run
            for step in run.steps:
                if step.status is StepStatus.RUNNING:
                    step.status, step.ended_at = StepStatus.FAILED, _now()
                    step.error = "stopped before the agent answered"
                elif step.status is StepStatus.PENDING:
                    step.status = StepStatus.SKIPPED
            done = all(s.status is StepStatus.DONE for s in run.steps)
            run.status = RunStatus.DONE if done else RunStatus.FAILED
            run.ended_at = _now()
            self._publish(run)
            # What was said and answered stays out of the server log (it may carry user context).
            log.info("run %s (%s): %s", run.id, run.scenario or "free text", run.status)

    async def _step(self, run: Run, step: StepState, session: str) -> bool:
        """Say one step; False if the agent gave no reply."""
        step.status, step.started_at = StepStatus.RUNNING, _now()
        self._publish(run)
        agent = self._config.callers[step.agent]
        try:
            reply = await self._openclaw.say(agent, step.say, session)
        except AgentError as e:
            step.status, step.ended_at, step.error = StepStatus.FAILED, _now(), str(e)
            return False
        step.status, step.ended_at = StepStatus.DONE, _now()
        step.reply, step.tokens = reply.text[:REPLY_LIMIT], reply.tokens
        self._publish(run)
        return True

    def _publish(self, run: Run) -> None:
        self.hub.publish(RunUpdated(run=run).model_dump(mode="json"))


def create_app(
    config: HomeConfig, *, openclaw_transport: httpx.AsyncBaseTransport | None = None
) -> FastAPI:
    """Build the Runner. `openclaw_transport` replaces the agents' OpenClaw gateways (tests)."""
    problems = []
    if config.openclaw_token is None:
        problems.append("OPENCLAW_GATEWAY_TOKEN is not set: the Runner talks to agents with it")
    if not any(c.role is Role.SIMULATOR for c in config.callers.values()):
        problems.append("SIMULATOR_TOKEN is not set: nobody could start a run")
    if problems:
        raise ConfigError(problems)
    openclaw = OpenClaw(config.openclaw_token, transport=openclaw_transport)
    runs = Runs(config, openclaw)
    auth = make_auth(config)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await runs.stop()
            await openclaw.aclose()

    app = FastAPI(title="Runner", lifespan=lifespan)
    hide_tokens_in_server_logs()
    allow_dashboards(app, config)

    @app.get("/health")
    async def health() -> dict:
        return {"ok": True, "running": runs.running is not None}

    @app.get("/scenarios")
    async def list_scenarios(_: auth.dashboard) -> list[Scenario]:
        return list(config.scenarios.values())

    @app.get("/runs")
    async def list_runs(_: auth.dashboard) -> list[Run]:
        """Recent runs, newest first."""
        return runs.recent()

    @app.get("/runs/{run_id}")
    async def get_run(run_id: str, _: auth.dashboard) -> Run:
        found = runs.get(run_id)
        if found is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, f"no run {run_id!r}")
        return found

    @app.post("/runs", status_code=status.HTTP_202_ACCEPTED)
    async def start_run(request: RunRequest, who: auth.simulator) -> Run:
        """Start a run; it goes on in the background. Follow it on /ws or GET /runs/{id}."""
        if request.scenario is not None:
            scenario = config.scenarios.get(request.scenario)
            if scenario is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, f"no scenario {request.scenario!r}")
            title, steps, expect = scenario.title, scenario.steps, scenario.expect
        else:
            agent = config.callers.get(request.agent or "")
            if agent is None or agent.role is not Role.AGENT:
                # 422 by number: Starlette renamed the constant (…_ENTITY -> …_CONTENT).
                raise HTTPException(422, f"{request.agent!r} is not an agent")
            title, expect = f"free text to {agent.id}", {}
            steps = [Step(agent=agent.id, say=request.say)]
        try:
            run = runs.start(title, request.scenario, steps, expect)
        except Busy as e:
            raise HTTPException(status.HTTP_409_CONFLICT, f"run {e.run_id} is still running") from e
        log.info("run %s started by %s", run.id, who.id)
        return run

    @app.websocket("/ws")
    async def follow_runs(websocket: WebSocket, token: str | None = None) -> None:
        if ws_caller(config, token, Role.OPERATOR, Role.SIMULATOR) is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        await websocket.accept()
        queue = runs.hub.subscribe()
        try:
            # No await between subscribing and building the snapshot, so nothing is missed.
            await websocket.send_json(runs.snapshot())
            await push(websocket, queue)
        except WebSocketDisconnect:
            pass
        finally:
            runs.hub.unsubscribe(queue)

    return app


def build() -> FastAPI:
    """App for `uvicorn runner.main:build --factory` (config files + environment)."""
    return create_app(load_config())
