"""Write JSON Schemas for Ambient-A2A messages into contracts/ambient/.

Run after changing ambient/schemas.py: python scripts/export_schemas.py
CI fails if the committed files are out of date.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ambient import schemas  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "contracts" / "ambient"
MODELS = [
    schemas.ContextUpdate,
    schemas.ContextSubscribe,
    schemas.ContextUnsubscribe,
    schemas.SubscribeResult,
    schemas.DeviceControl,
    schemas.ControlResult,
]

OUT.mkdir(parents=True, exist_ok=True)
for model in MODELS:
    name = model.model_fields["type"].default
    (OUT / f"{name}.schema.json").write_text(
        json.dumps(model.model_json_schema(), indent=2, ensure_ascii=False) + "\n"
    )
print(f"wrote {len(MODELS)} schemas to {OUT}")
