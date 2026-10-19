"""Run ambient_dpo.ipynb's own code on this machine with a tiny EXAONE-4-shaped model (CPU, 2 steps each).

  ~/.ambient-a2a/venvs/trl/bin/python training/smoke_test.py

Catches what would otherwise fail on Colab: data rendering against the real EXAONE 4.0 tokenizer/template,
TRL argument names, EOS handling, SFT -> merge -> DPO, offline scoring. Colab-only parts (pip, Drive,
upload, GGUF export) are skipped; the real model is replaced by a 2-layer random model of the same class.
"""

import json
import shutil
import tempfile
from pathlib import Path

import torch
import transformers

HERE = Path(__file__).resolve().parent
DATA = Path.home() / ".ambient-a2a" / "training" / "data"
BASE = "LGAI-EXAONE/EXAONE-4.0-1.2B"

cells = [c for c in json.loads((HERE / "ambient_dpo.ipynb").read_text())["cells"] if c["cell_type"] == "code"]
src = ["".join(c["source"]) for c in cells]
# cells: 0 pip/nvidia, 1 colab upload, 2 render, 3 sft, 4 dpo, 5 offline score, 6 gguf
run = src[2:6]

tiny_dir = Path(tempfile.mkdtemp()) / "tiny"
cfg = transformers.AutoConfig.from_pretrained(BASE)
cfg.num_hidden_layers, cfg.hidden_size, cfg.intermediate_size = 2, 64, 128
cfg.num_attention_heads, cfg.num_key_value_heads, cfg.head_dim = 4, 2, 16
if hasattr(cfg, "layer_types") and cfg.layer_types:
    cfg.layer_types = cfg.layer_types[:2]
transformers.AutoModelForCausalLM.from_config(cfg).save_pretrained(tiny_dir)

_orig = transformers.AutoModelForCausalLM.from_pretrained


def tiny_from_pretrained(name, *a, **k):
    return _orig(tiny_dir if name == BASE else name, *a, **k)


transformers.AutoModelForCausalLM.from_pretrained = tiny_from_pretrained

out = Path(tempfile.mkdtemp())
data_dir = Path(tempfile.mkdtemp())
for p in DATA.glob("*.jsonl"):  # keep it small: 4 rows per file
    data_dir.joinpath(p.name).write_text("".join(p.read_text().splitlines(keepends=True)[:4]))

patches = [("/content/data", str(data_dir)), ("bf16=bf16, fp16=not bf16", "bf16=False, fp16=False, use_cpu=True"),
           ("num_train_epochs=3", "max_steps=2"), ("num_train_epochs=2", "max_steps=2"),
           (".to('cuda')", ""), ("eval_strategy='epoch'", "eval_strategy='no'"),
           ("save_strategy='epoch'", "save_strategy='no'"), ("torch.cuda.empty_cache()", "pass"),
           ("rows = load('sft_eval')", "rows = load('sft_eval')[:2]"), ("max_new_tokens=400", "max_new_tokens=20")]
ns = {"OUT": str(out), "torch": torch}
for i, code in enumerate(run, start=2):
    for a, b in patches:
        code = code.replace(a, b)
    print(f"--- cell {i} ---", flush=True)
    exec(compile(code, f"cell{i}", "exec"), ns)
print("SMOKE TEST PASSED:", sorted(p.name for p in out.iterdir()))
shutil.rmtree(out, ignore_errors=True)
