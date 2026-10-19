"""Turn proxy logs into SFT and DPO datasets (conversational, with tools) for TRL.

  python training/build_dataset.py --teacher haiku --samples 3 [--zip]

Inputs (in ~/.ambient-a2a/training): calls.jsonl (proxy log), results.jsonl (scenario verdicts).
Teacher calls are kept only from training scenarios the teacher passed (tag prefix --teacher, e.g. "haiku"
matches haiku1, haiku2 …). Rejected answers come from the base student (llama-server :8090) given the
identical request; a pair is kept only when the student's answer is clearly worse:
  - teacher called tools and the student's calls differ on name/target/device/command/value/fields, or
  - teacher answered in text and the student called tools or did not answer in Korean.
Output rows: {"id", "split", "tools", "prompt": [...], "completion" | "chosen"/"rejected": [assistant msg]}.
Aborts if any secret from .env appears in the data.
"""

import argparse
import json
import random
import zipfile
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
RUN = Path.home() / ".ambient-a2a" / "training"
ENV = dict(l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if "=" in l and not l.startswith("#"))
SECRETS = [v for k, v in ENV.items() if ("TOKEN" in k or "KEY" in k or "PASSWORD" in k) and len(v) >= 12]
KEY_ARGS = ("target", "device", "command", "value", "fields")


def text_of(content):
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return content or ""


def norm_msg(m):
    out = {"role": m["role"], "content": text_of(m.get("content"))}
    if m.get("tool_calls"):
        out["tool_calls"] = []
        for tc in m["tool_calls"]:
            fn = tc.get("function", tc)
            args = fn.get("arguments") or "{}"
            try:
                args = json.loads(args) if isinstance(args, str) else args
            except json.JSONDecodeError:
                args = {"_raw": args}
            out["tool_calls"].append({"type": "function", "function": {"name": fn.get("name", ""), "arguments": args}})
    return out


def korean(text):
    h = sum("가" <= c <= "힣" for c in text)
    a = sum(c.isascii() and c.isalpha() for c in text)
    return h > 5 and h >= a * 0.5


def signature(m):
    calls = []
    for tc in m.get("tool_calls") or []:
        args = tc["function"]["arguments"]
        key = {k: args.get(k) for k in KEY_ARGS if isinstance(args, dict) and k in args}
        if isinstance(key.get("fields"), (dict, list)):
            key["fields"] = sorted(key["fields"])
        calls.append((tc["function"]["name"], json.dumps(key, sort_keys=True, ensure_ascii=False)))
    return sorted(calls)


def worse(chosen, cand):
    if chosen.get("tool_calls"):
        return signature(cand) != signature(chosen)
    return bool(cand.get("tool_calls")) or not korean(cand.get("content") or "")


def student(request, temperature):
    body = {"model": "exaone", "messages": request["messages"], "tools": request.get("tools"),
            "temperature": temperature, "max_tokens": 1024, "stream": False}
    r = httpx.post("http://127.0.0.1:8090/v1/chat/completions", json=body, timeout=300)
    r.raise_for_status()
    return norm_msg(r.json()["choices"][0]["message"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--teacher", required=True, help="tag prefix of the teacher runs")
    ap.add_argument("--samples", type=int, default=3)
    ap.add_argument("--eval-frac", type=float, default=0.15)
    ap.add_argument("--zip", action="store_true", help="also write ambient-dpo-data.zip for Colab")
    a = ap.parse_args()

    results = [json.loads(l) for l in open(RUN / "results.jsonl")]
    passed = {r["tag"] for r in results if r["pass"] and r["tag"].startswith(a.teacher) and ":t-" in r["tag"]}
    calls = [c for c in map(json.loads, open(RUN / "calls.jsonl")) if c["tag"] in passed
             and not any(m.get("role") == "tool" and '"status": "error"' in text_of(m.get("content"))
                         for m in c["request"]["messages"])]  # teacher answers after a tool error are not examples
    random.seed(0)
    scen = sorted({t.split(":", 1)[1] for t in passed})
    eval_scen = set(random.sample(scen, max(1, int(len(scen) * a.eval_frac))))

    sft, dpo = [], []
    for i, c in enumerate(calls):
        req = c["request"]
        chosen = norm_msg(c["response"])
        if not chosen["content"] and not chosen.get("tool_calls"):
            continue
        split = "eval" if c["tag"].split(":", 1)[1] in eval_scen else "train"
        base = {"id": f"{c['tag']}#{i}", "split": split, "tools": req.get("tools") or [],
                "prompt": [norm_msg(m) for m in req["messages"]]}
        sft.append({**base, "completion": [chosen]})
        for t in [0.0] + [0.8] * (a.samples - 1):
            cand = student(req, t)
            if worse(chosen, cand):
                dpo.append({**base, "chosen": [chosen], "rejected": [cand], "student_temperature": t})
                break
        print(f"{i + 1}/{len(calls)} sft={len(sft)} dpo={len(dpo)}", flush=True)

    blob = json.dumps(sft + dpo, ensure_ascii=False)
    if leaked := [s[:4] + "…" for s in SECRETS if s in blob]:
        raise SystemExit(f"secret values found in data ({leaked}); not writing")
    out = RUN / "data"
    out.mkdir(parents=True, exist_ok=True)
    for name, rows in (("sft", sft), ("dpo", dpo)):
        for split in ("train", "eval"):
            with open(out / f"{name}_{split}.jsonl", "w") as f:
                for r in rows:
                    if r["split"] == split:
                        f.write(json.dumps(r, ensure_ascii=False) + "\n")
    if a.zip:
        with zipfile.ZipFile(RUN / "ambient-dpo-data.zip", "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(out.glob("*.jsonl")):
                z.write(p, p.name)
    print(json.dumps({"teacher_scenarios": len(scen), "eval_scenarios": len(eval_scen), "sft": len(sft),
                      "dpo": len(dpo), "out": str(out)}))


if __name__ == "__main__":
    main()
