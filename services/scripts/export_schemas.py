"""Write JSON Schemas for Ambient-A2A messages into contracts/ambient/ and the Event Collector
event into contracts/collector/.

Run after changing ambient/schemas.py or collector/events.py: python scripts/export_schemas.py
CI fails if the committed files are out of date.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ambient import schemas  # noqa: E402
from collector.events import AgentEvent  # noqa: E402

CONTRACTS = Path(__file__).resolve().parent.parent / "contracts"
OUT = CONTRACTS / "ambient"
MODELS = [
    schemas.ContextUpdate,
    schemas.ContextSubscribe,
    schemas.ContextUnsubscribe,
    schemas.SubscribeResult,
    schemas.DeviceControl,
    schemas.ControlResult,
]


def write(path: Path, model: type) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(model.model_json_schema(), indent=2, ensure_ascii=False) + "\n")


for model in MODELS:
    name = model.model_fields["type"].default
    write(OUT / f"{name}.schema.json", model)
print(f"wrote {len(MODELS)} schemas to {OUT}")

write(CONTRACTS / "collector" / "event.schema.json", AgentEvent)
print(f"wrote event schema to {CONTRACTS / 'collector'}")
