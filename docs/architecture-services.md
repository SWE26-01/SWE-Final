# Architecture: services

The `services/` part of the architecture. The agents and the Home A2A messages are described in
`spec/home-a2a.md` and `plan.md`; this part covers the four services next to them. Everything runs
from the root `docker-compose.yml`.

## 1. Role in the system

```
                 A2A + Home A2A (spec/home-a2a.md)
 desktop, smartphone  <──────────────────────────────>  root (Root), room1, room2
                                                          │ device commands          │ event log
                                                          │ (own agent token)        │ (own agent token)
                                                          ▼                          ▼
                                                   Device Gateway             Event Collector
                                                   (the virtual home)                │
                                                          └──state──▶ dashboards ◀───┘
                                                                     (read-only token)

 Agent Studio ──register (STUDIO_TOKEN)──▶ Agent Hub ──reads Agent Cards──▶ agents
   (plain language → agent)                (registry in PostgreSQL, connections, ownership)
```

| Plan item (plan.md 5) | Covered by |
| --- | --- |
| Virtual smart-home devices, one owner per device | Device Gateway |
| Communication and control-result log | Event Collector |
| Agentic Studio: make agents in plain language | Agent Studio |
| Agentic Hub: registry, search, connect (install) | Agent Hub (+ the `web/` screens: Agent Cloud and the smart home app) |

## 2. Device Gateway (`services/gateway/`)

**The virtual home.** There is no Home Assistant or real hardware. The Gateway keeps the state of
every device in `config/devices.yaml` in memory (`gateway/home.py`). A device starts `off`, or in
the first of its `options` for an `input_select`; restarting the Gateway resets the home.

**Interface.** The Gateway speaks the subset of the Home Assistant REST API the agents use, with
Home Assistant's state shape, so an agent needs only a base URL (`gatewayUrl`) and its own token:

| Endpoint | Caller | Behaviour |
| --- | --- | --- |
| `POST /api/services/<domain>/<service>` | agents | Changes the devices only if the service is a plain device command and the caller owns every target entity; answers the new states |
| `GET /api/states/<entity>` | any known token | State of a home device; anything else is not found |
| `GET /devices` | any known token | Every device with its space, owner and state |
| `WebSocket /ws?token=` | operators | `snapshot`, then `device.state_changed` (`contracts/gateway/stream.schema.json`) |

**Command check.** For each service call the Gateway:
1. authenticates the bearer token and requires an agent (operators cannot command devices);
2. allows only `input_boolean` `turn_on`/`turn_off`/`toggle`, `input_select.select_option` and
   `input_number.set_value`, with exactly the data keys those services take;
3. expands `entity_id` (a string, a comma-separated string or a list; `all` is just an unknown
   entity) and requires every entity to be a home device owned by the caller, in the service's domain;
4. checks the value (an `input_select` option must be one of its options), then changes the devices
   and announces each real change to the dashboards.

Anything refused changes nothing; the refusal is logged and answered with 403 or 400 in Home
Assistant's error shape (`{"message": ...}`). The agents also refuse devices they do not own, but
that check lives in the same code that could be wrong (or be misled by its LLM); the Gateway is a
second check outside the agents.

## 3. Event Collector (`services/collector/`)

**Input.** Each agent sends its event-log lines (`in`, `out`, `out-result`, `out-error`, `exec`,
`rule`) with its own token to `POST /events`. The reporting agent must match the token. Only the
fields in `collector/events.py` are stored; unknown fields are dropped and free text is cut to 300
characters, so a new log field can never carry context values (calendar titles, locations) into the log.

**Output (operators only).**

| Endpoint | Content |
| --- | --- |
| `GET /events?after_id=&limit=` | The log in order, paged |
| `WebSocket /ws?token=` | The last 200 events, then each new event |
| `GET /flows?limit=` | One summary per request: who asked, which agent answered, the action, the final `accepted`/`reason_code`, the agents involved |
| `GET /flows/{flow}` | All events of one request |

**Flows.** The agents keep one `request_id` through delegation, execution, energy saving (each room
gets `<id>/<room>`) and automation rules, so the part before the first `/` identifies a request across
agents. The Collector stores it as `flow` on every event, in one SQLite table in a Docker volume.
Each stored event also gets `received_at`, the Collector's own arrival time.

## 4. Agent Hub and Agent Studio

Described with their endpoints in `services/README.md`. In short: Studio turns a request into a fixed
slot form filled by an LLM (LangChain + OpenRouter), compiles built-in skills (`config/skills.yaml`)
into the agent's rules, checks the generated runtime files (`studio/runtime.py`; OpenClaw today) and
registers the agent in the Hub after the user approves. The Hub keeps the registry in PostgreSQL,
reads Agent Cards, connects agents with per-agent tokens (only the sha256 is stored) and refuses a
connection that would give a device a second owner.

## 5. Security and privacy

- **Identities.** Every caller has its own bearer token (the agents' `AGENT_TOKEN_*`, the dashboard's
  `DASHBOARD_TOKEN`, the home user's `HOME_USER_TOKEN`, Studio's `STUDIO_TOKEN`). Tokens live only in
  the root `.env`; `config/agents.yaml` names the variables.
- **Least privilege.** Only agents command devices, and only their own. Operators read; the home user
  creates and connects agents but commands no device.
- **Data exposure.** The Collector stores a fixed set of fields and no context values.
- **Known limit.** All agents run from one `.env`, so a compromised agent process could read the other
  tokens. Per-agent secrets or mTLS would be needed for mutually untrusted agents (same limit as the
  agents' peer tokens).

## 6. Configuration and deployment

- `services/config/agents.yaml`: callers and the environment variable holding each token.
- `services/config/devices.yaml`: device → space, owning agent, kind, display name and options. It
  must match the agents' `owned` lists; `verify_integration.py` checks it against the running Agent Cards.
- `docker-compose.yml` (repo root) runs the agents, the four services, PostgreSQL and the Hub screen.
  Inside Docker the agents reach the services as `gateway`/`collector`, and the services reach the
  agents' cards as `agents` (`AGENTS_HOST`, `HUB_AGENTS_HOST`).

| Failure | Behaviour |
| --- | --- |
| Gateway down | The agents' device commands fail (`EXECUTION_FAILED`) until it is back; the home restarts in its initial state |
| Collector down | Agents keep working; their events for that time are lost (the agents' local log files remain) |
| PostgreSQL down | The Hub and Studio fail their requests; agents and devices keep working |

## 7. Verification

- Unit tests: `services/` (`pytest`, no LLM or Docker needed) and the agent plugin (`pnpm test`).
- `services/scripts/verify_integration.py` on the running system:
  1. every Agent Card's `owned_devices` equals `config/devices.yaml`;
  2. every agent's command on another agent's device, and `homeassistant.restart`, is refused (403);
  3. events from every platform agent reached the Collector.
- `scripts/test_hub_studio.sh`: 26 HTTP checks of Studio and the Hub.
- Result on 2026-11-20 (everything from `docker compose up`): `scripts/scenario.sh --kill-home`,
  `verify_integration.py` and `test_hub_studio.sh` (with the real LLM) all passed.
