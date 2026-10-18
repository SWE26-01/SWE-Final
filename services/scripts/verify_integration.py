"""Check the running system: the agents + the Device Gateway and the Event Collector.

Start the agents (../scripts/run_all.sh) pointed at the Gateway, start the Gateway and the
Collector, run ../scripts/scenario.sh, then:

    python scripts/verify_integration.py --env-file ../.env

Checks (plan 8.3, "each Room Agent directly controls only its own devices", plus the log):
  1. every Agent Card's `owned_devices` matches config/devices.yaml
  2. the Gateway refuses each agent's command on a device it does not own,
     and anything that is not a plain device command
  3. the Event Collector has events from every agent
Exit code 1 if any check fails. Moves nothing: each command it sends asks for the state the
device is already in.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import httpx
from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from homeconfig import HomeConfig, load_config  # noqa: E402
from homeconfig.models import Role  # noqa: E402

EXT_PREFIX = "https://github.com/nsu102/A2A-agents/spec/ambient-a2a/"
failures: list[str] = []


def check(ok: bool, what: str) -> None:
    print(f"  {'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failures.append(what)


def cards(config: HomeConfig) -> None:
    print("1. Agent Cards declare the same owners as config/devices.yaml")
    for agent in config.agents():
        try:
            card = httpx.get(f"{agent.url}/.well-known/agent-card.json", timeout=5).json()
        except httpx.HTTPError as e:
            check(False, f"{agent.id}: card not reachable ({e!r})")
            continue
        ext = next(
            (e for e in card.get("capabilities", {}).get("extensions", [])
             if e.get("uri", "").startswith(EXT_PREFIX)),
            None,
        )
        declared = set((ext or {}).get("params", {}).get("owned_devices", []))
        expected = set(config.owned_by(agent.id))
        check(declared == expected, f"{agent.id}: owns {sorted(expected) or 'nothing'}")
        if declared != expected:
            print(f"       card says {sorted(declared)}")


def gateway(config: HomeConfig, url: str) -> None:
    print("2. Gateway refuses commands outside the caller's own devices")
    with httpx.Client(base_url=url, timeout=5) as http:
        for agent in config.agents():
            headers = {"Authorization": f"Bearer {agent.token}"}
            other = next(
                (d for d in config.devices.values()
                 if d.owner != agent.id and d.domain == "input_boolean"),
                None,
            )
            if other is not None:
                # Ask for the state the device is already in, so nothing moves even if the
                # Gateway wrongly let it through.
                now = http.get(f"/api/states/{other.entity}", headers=headers).json()
                service = "turn_on" if now.get("state") == "on" else "turn_off"
                r = http.post(
                    f"/api/services/input_boolean/{service}",
                    json={"entity_id": other.entity},
                    headers=headers,
                )
                check(r.status_code == 403, f"{agent.id} -> {other.entity}: {r.status_code}")
            r = http.post("/api/services/homeassistant/restart", json={}, headers=headers)
            check(r.status_code == 403, f"{agent.id} -> homeassistant.restart: {r.status_code}")


def collector(config: HomeConfig, url: str) -> None:
    print("3. Event Collector has events from every agent")
    operator = next((c for c in config.callers.values() if c.role is Role.OPERATOR), None)
    if operator is None:
        check(False, "no operator in config/agents.yaml to read events with")
        return
    headers = {"Authorization": f"Bearer {operator.token}"}
    seen: dict[str, int] = {}
    after = 0
    with httpx.Client(base_url=url, timeout=5) as http:
        while True:
            page = http.get("/events", params={"after_id": after, "limit": 500}, headers=headers)
            page.raise_for_status()
            events = page.json()
            if not events:
                break
            for e in events:
                seen[e["agent"]] = seen.get(e["agent"], 0) + 1
            after = events[-1]["id"]
    for agent in config.agents():
        check(seen.get(agent.id, 0) > 0, f"{agent.id}: {seen.get(agent.id, 0)} events")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--env-file", help="the root .env with the agent tokens")
    parser.add_argument("--gateway", default="http://127.0.0.1:8100")
    parser.add_argument("--collector", default="http://127.0.0.1:8200")
    args = parser.parse_args()
    env = {**(dotenv_values(args.env_file) if args.env_file else {}), **os.environ}
    config = load_config(env={k: v for k, v in env.items() if v is not None})

    cards(config)
    gateway(config, args.gateway)
    collector(config, args.collector)
    print("\nall checks passed" if not failures else f"\n{len(failures)} check(s) failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
