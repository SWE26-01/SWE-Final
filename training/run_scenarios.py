"""Run scenarios against the live agents (whatever model they run) and judge each outcome.

  python training/run_scenarios.py --set train   --tag haiku1           # teacher data collection
  python training/run_scenarios.py --set heldout --tag eval-exaone-dpo  # evaluation
  options: --only <agent>  --ids id1,id2  --limit N

Needs: agents up (training/lab.sh agents <model>), proxy on :8300 (for tags), HA + Gateway.
Results append to ~/.ambient-a2a/training/results.jsonl.
"""

import argparse
import json
import re
import time
import uuid
from pathlib import Path

import httpx

from scenarios import BASE, HELDOUT, SCENARIOS

ROOT = Path(__file__).resolve().parent.parent
RUN = Path.home() / ".ambient-a2a" / "training"
ENV = dict(l.split("=", 1) for l in (ROOT / ".env").read_text().splitlines() if "=" in l and not l.startswith("#"))
HA, HA_TOKEN, GW_TOKEN = ENV["HA_URL"], ENV["HA_TOKEN"], ENV["OPENCLAW_GATEWAY_TOKEN"]
PORT = {"desktop": 18800, "smartphone": 18920, "orchestrator": 19040, "room1": 19160, "room2": 19280}
EVENTS = ROOT / "logs" / "events.jsonl"
DEVICES = set(BASE)
ha = httpx.Client(base_url=HA, headers={"Authorization": f"Bearer {HA_TOKEN}"}, timeout=10)


def set_state(entity, state):
    domain = entity.split(".")[0]
    if domain == "input_select":
        ha.post("/api/services/input_select/select_option", json={"entity_id": entity, "option": state})
    else:
        ha.post(f"/api/services/{domain}/turn_{state}", json={"entity_id": entity})


def get_state(entity):
    return ha.get(f"/api/states/{entity}").json()["state"]


def korean(text):
    h = sum("가" <= c <= "힣" for c in text)
    a = sum(c.isascii() and c.isalpha() for c in text)
    return h > 5 and h >= a * 0.5


def judge(s, reply, events):
    fails = []
    mine = [e for e in events if e.get("agent") == s["agent"]]
    out = [e for e in mine if e.get("dir") == "out"]
    sent = {f"{e.get('to')}:{(e.get('action') or {}).get('device')}" for e in out if e.get("type") == "device.control"}
    queried = {e.get("to") for e in out if e.get("type") == "context.query"}
    published = any(e.get("type") == "context.update" for e in out)
    devs = {(e.get("action") or {}).get("device") for e in events if e.get("action")} - {None}
    for ent, want in (s.get("ha") or {}).items():
        if (got := get_state(ent)) != want:
            fails.append(f"ha {ent}={got}!={want}")
    for want in s.get("sent", []):
        if want not in sent:
            fails.append(f"not sent {want} (sent={sorted(sent)})")
    for want in s.get("queried", []):
        if want not in queried:
            fails.append(f"not queried {want}")
    if s.get("published") and not published:
        fails.append("not published")
    if s.get("no_exec") and (any(e.get("dir") == "exec" for e in mine) or any(e.get("type") == "device.control" for e in out)):
        fails.append("executed/requested a device change")
    if s.get("no_publish") and published:
        fails.append("published")
    if invented := devs - DEVICES:
        fails.append(f"invented ids {sorted(invented)}")
    if s.get("mention") and not re.search(s["mention"], reply):
        fails.append(f"reply lacks /{s['mention']}/")
    if not korean(reply):
        fails.append("reply not Korean")
    return fails


def run(s, tag):
    for ent, st in {**BASE, **s["init"]}.items():
        set_state(ent, st)
    time.sleep(1.5)
    httpx.post("http://127.0.0.1:8300/tag", content=tag, timeout=5)
    n = len(EVENTS.read_text().splitlines()) if EVENTS.exists() else 0
    t0 = time.time()
    try:
        r = httpx.post(f"http://127.0.0.1:{PORT[s['agent']]}/v1/chat/completions", timeout=300,
                       headers={"Authorization": f"Bearer {GW_TOKEN}"},
                       json={"model": "openclaw", "user": f"conv:{tag}-{uuid.uuid4().hex[:6]}",
                             "messages": [{"role": "user", "content": s["say"]}]})
        reply = r.json()["choices"][0]["message"]["content"] if r.status_code == 200 else f"HTTP {r.status_code}"
    except Exception as e:  # noqa: BLE001 - record and continue
        reply = f"ERROR {e}"
    lat = round(time.time() - t0, 1)
    time.sleep(3)  # let rules / delegations settle
    events = [json.loads(l) for l in EVENTS.read_text().splitlines()[n:]] if EVENTS.exists() else []
    infra = reply.startswith(("HTTP ", "ERROR "))
    fails = [f"infrastructure: {reply[:80]}"] if infra else judge(s, reply, events)
    return {"id": s["id"], "tag": tag, "agent": s["agent"], "say": s["say"], "pass": not fails, "infra_error": infra,
            "fails": fails, "latency_s": lat, "reply": reply}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", choices=["train", "heldout"], required=True)
    ap.add_argument("--tag", required=True, help="run name, e.g. haiku1 or eval-exaone")
    ap.add_argument("--only")
    ap.add_argument("--ids", help="comma-separated scenario ids")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    ids = set(a.ids.split(",")) if a.ids else None
    rows = SCENARIOS if a.set == "train" else HELDOUT
    todo = [s for s in rows if (not a.only or s["agent"] == a.only) and (not ids or s["id"] in ids)][: a.limit]
    RUN.mkdir(parents=True, exist_ok=True)
    out = RUN / "results.jsonl"
    with open(out, "a") as f:
        for s in todo:
            res = run(s, f"{a.tag}:{s['id']}")
            f.write(json.dumps(res, ensure_ascii=False) + "\n")
            f.flush()
            print(f"{'PASS' if res['pass'] else 'FAIL'} {res['id']} {res['latency_s']:>5}s {s['say'][:24]:24} {'; '.join(res['fails'])[:110]}", flush=True)
            if res["infra_error"]:
                httpx.get("https://openrouter.ai/api/v1/models", timeout=10)  # fail fast when the network is gone
    mine = [json.loads(l) for l in open(out) if json.loads(l)["tag"].startswith(a.tag + ":")]
    lats = sorted(r["latency_s"] for r in mine)
    print(f"== {a.tag}: {sum(r['pass'] for r in mine)}/{len(mine)} passed, median {lats[len(lats) // 2] if lats else '-'}s, "
          f"infra errors {sum(r['infra_error'] for r in mine)}")
