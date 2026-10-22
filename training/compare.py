"""Side-by-side comparison of evaluation runs (same scenarios, different models).

  python training/compare.py eval-exaone-base eval-exaone-sft eval-exaone-dpo eval-haiku [--out compare.json]

For each run tag and scenario: pass/fail with reasons, latency, the agent's final reply, and every tool call
the model made during the turn (from the proxy log). Writes JSON for the comparison page and prints a summary.
"""

import argparse
import json
from pathlib import Path

RUN = Path.home() / ".ambient-a2a" / "training"


def tool_calls(calls, tag, since=0.0, until=float("inf")):
    out = []
    for c in calls:
        if c["tag"] != tag or not since <= c["ts"] <= until:
            continue
        for tc in c["response"].get("tool_calls") or []:
            fn = tc.get("function", {})
            args = fn.get("arguments")
            try:
                args = json.loads(args) if isinstance(args, str) else args
            except json.JSONDecodeError:
                pass
            out.append({"name": fn.get("name"), "arguments": args})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tags", nargs="+")
    ap.add_argument("--out", default=str(RUN / "compare.json"))
    ap.add_argument("--since", type=float, default=0.0, help="ignore proxy calls before this epoch (rows without a start time)")
    a = ap.parse_args()
    results = [json.loads(l) for l in open(RUN / "results.jsonl")]
    calls = [json.loads(l) for l in open(RUN / "calls.jsonl")]
    scen = {}
    for tag in a.tags:
        rows = [r for r in results if r["tag"].startswith(tag + ":")]
        last = {}
        for r in rows:  # latest attempt per scenario wins
            last[r["id"]] = r
        for sid, r in last.items():
            s = scen.setdefault(sid, {"id": sid, "agent": r["agent"], "say": r["say"], "runs": {}})
            # Same tag run twice: only the calls of the latest run (its start time is recorded since 2026-10-22)
            since = r.get("ts", a.since)
            until = since + r["latency_s"] + 10 if "ts" in r else float("inf")
            s["runs"][tag] = {"pass": r["pass"], "fails": r["fails"], "latency_s": r["latency_s"], "reply": r["reply"],
                              "tool_calls": tool_calls(calls, r["tag"], since, until)}
    order = sorted(scen.values(), key=lambda s: s["id"])
    summary = {t: {"passed": sum(s["runs"].get(t, {}).get("pass", False) for s in order),
                   "total": sum(t in s["runs"] for s in order)} for t in a.tags}
    Path(a.out).write_text(json.dumps({"tags": a.tags, "summary": summary, "scenarios": order}, ensure_ascii=False, indent=1))
    for t, v in summary.items():
        print(f"{t:22} {v['passed']}/{v['total']}")
    print("wrote", a.out)


if __name__ == "__main__":
    main()
