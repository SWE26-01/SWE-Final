"""Write JSON Schemas for what dashboards and agents exchange with this repo's services:
contracts/collector/{event,flow,agent}.schema.json and contracts/gateway/stream.schema.json.

Run after changing collector/events.py, collector/flows.py or gateway/stream.py:
    python scripts/export_schemas.py
CI fails if the committed files are out of date.
"""

import json
import sys
from pathlib import Path
from typing import Annotated

from pydantic import Field, TypeAdapter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from collector.agents import AgentStatus  # noqa: E402
from collector.events import AgentEvent  # noqa: E402
from collector.flows import Flow  # noqa: E402
from gateway.stream import Snapshot, StateChanged  # noqa: E402

CONTRACTS = Path(__file__).resolve().parent.parent / "contracts"


def write(path: Path, schema: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {path.relative_to(CONTRACTS.parent)}")


write(CONTRACTS / "collector" / "event.schema.json", AgentEvent.model_json_schema())
write(CONTRACTS / "collector" / "flow.schema.json", Flow.model_json_schema())
write(CONTRACTS / "collector" / "agent.schema.json", AgentStatus.model_json_schema())
stream = TypeAdapter(Annotated[Snapshot | StateChanged, Field(discriminator="type")])
write(CONTRACTS / "gateway" / "stream.schema.json", stream.json_schema())
