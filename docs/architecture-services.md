# Architecture: Device Gateway, Event Collector and Runner

This is the `services/` part of the requirements and architecture document (W12-2, #5).
The agents, the Ambient-A2A extension and the virtual devices are described elsewhere
(`spec/ambient-a2a.md`, `plan.md`); this part covers the three services that sit next to them.

## 1. Role in the system

```
                 A2A + Ambient-A2A (spec/ambient-a2a.md)
 desktop, smartphone  <──────────────────────────────>  orchestrator (Home), room1, room2
                                                          │ device commands          │ event log
                                                          │ (own agent token)        │ (own agent token)
                                                          ▼                          ▼
                                                   Device Gateway             Event Collector
                                                          │ HA token                 │
                                                          ▼                          ▼
                                                   Home Assistant  ──state──▶  dashboards / simulator
                                                   (virtual devices)            (read-only token)
```

| Plan item (plan.md 8.1, 8.3) | Covered by |
| --- | --- |
| P0 Virtual Device Gateway | Device Gateway |
| P0 A2A communication and control-result log | Event Collector |
| Check "each Room Agent controls only its own devices" | Device Gateway, independently of the agents' own checks |

Home Assistant has no per-entity permissions: any holder of a token can move any device. The agents
already refuse devices they do not own, but that check lives in the same code that could be wrong
(or be misled by its LLM). The Gateway is a second check outside the agents. The Collector gives
the dashboard one place to read what every agent did and why.

## 2. Device Gateway (`services/gateway/`)

**Interface.** The Gateway speaks the subset of the Home Assistant REST API the agents use, so an
agent switches to it by changing only its base URL and token:

| Endpoint | Caller | Behaviour |
| --- | --- | --- |
| `POST /api/services/<domain>/<service>` | agents | Forwarded to HA only if the service is a plain device command and the caller owns every target entity |
| `GET /api/states/<entity>` | agents, operators | Forwarded to HA for entities in `config/devices.yaml`; any other entity is reported as not found |
| `GET /devices` | agents, operators | Latest state of every home device with its space and owner |
| `WebSocket /ws?token=` | operators | `snapshot`, then `device.state_changed` (`contracts/gateway/stream.schema.json`) |

**Command check.** For each service call the Gateway:
1. authenticates the bearer token and requires an agent (operators cannot command devices);
2. allows only `input_boolean` `turn_on`/`turn_off`/`toggle`, `input_select.select_option` and
   `input_number.set_value`, with exactly the data keys those services take (no `area_id`, no
   `target`, no other domains such as `homeassistant.restart`);
3. expands `entity_id` (a string, a comma-separated string or a list; `all` is just an unknown
   entity) and requires every entity to be a home device owned by the caller, in the service's domain;
4. forwards the normalised call with the single Home Assistant token and returns HA's answer.

Anything refused never reaches Home Assistant; the refusal is logged and answered with 403 or 400 in
Home Assistant's error shape. If Home Assistant is unreachable the answer is 502.

**State stream.** The Gateway subscribes to Home Assistant's `state_changed` events over WebSocket and
keeps the latest state of the home devices. After every (re)connect it reloads all states and sends a
fresh `snapshot`, so dashboards recover from a Home Assistant restart without polling.

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
agents. The Collector stores it as `flow` on every event. Storage is a single SQLite table, kept in a
Docker volume.

## 4. Runner (`services/runner/`)

The frontend's Live Simulation shows the agents' real LLM behaviour. The Runner plays the user: it says
a scenario step (`config/scenarios.yaml`) or free text to an agent's LLM through that agent's OpenClaw
chat endpoint (`POST /v1/chat/completions`, enabled per gateway with
`gateway.http.endpoints.chatCompletions.enabled`), one step after the other, one run at a time.

| Endpoint | Caller | Behaviour |
| --- | --- | --- |
| `GET /scenarios` | operators, simulators | The configured scenarios (`contracts/runner/scenario.schema.json`) |
| `POST /runs` | simulators | Start a scenario or one free-text message; 202 with the run, 409 while another run is going |
| `GET /runs`, `GET /runs/{id}` | operators, simulators | Recent runs (memory only) with each step's reply or error |
| `WebSocket /ws?token=` | operators, simulators | `snapshot`, then the whole run after every change (`contracts/runner/stream.schema.json`) |

The Runner never calls the Gateway or Home Assistant and holds no agent token, so it cannot move a
device or speak as an agent; the agent's LLM decides and the agents' policies and the Gateway apply as
for any other request. Setup steps that prepare a scenario are also said to the device's own agent.
OpenClaw answers with the final text only, so the screen shows what the agents did from the
Collector's events after the run's `started_at` and from the Gateway's device changes.

## 5. Security and privacy

- **Identities.** Every caller has its own bearer token (the agents' `AMBIENT_TOKEN_*`, the dashboard's
  `DASHBOARD_TOKEN`, the Live Simulation's `SIMULATOR_TOKEN`). Tokens live only in the root `.env`; `config/agents.yaml` names the variables.
- **Least privilege.** With the Gateway on, agents no longer use the Home Assistant token; only the
  Gateway and the setup scripts do. Operators can read but not command or report. Only the Runner
  holds the OpenClaw gateway token, and only simulators can start runs.
- **Data exposure.** The Gateway exposes only entities listed in `config/devices.yaml` (HA also holds
  people and zones). The Collector stores a fixed set of fields and no context values.
- **Known limit.** All agents run from one `.env`, so a compromised agent process could read the other
  tokens. Per-agent secrets or mTLS would be needed for mutually untrusted agents (same limit as the
  agents' peer tokens).

## 6. Configuration and deployment

- `services/config/agents.yaml`: callers and the environment variable holding each token.
- `services/config/devices.yaml`: Home Assistant entity → space and owning agent. It must match the
  Home Assistant config and the agents' `owned` lists; `verify_integration.py` checks it against the
  running Agent Cards.
- `scripts/run_all.sh` starts the services with Docker Compose and points the agents at them
  (`AMBIENT_GATEWAY_URL`, `AMBIENT_COLLECTOR_URL`; `AMBIENT_SERVICES=off` to skip). If they do not come
  up, the agents fall back to Home Assistant directly.

| Failure | Behaviour |
| --- | --- |
| Home Assistant down | Gateway answers 502; the event stream reconnects with backoff and resends a snapshot |
| Collector down | Agents keep working; their events for that time are lost (the agents' local log files remain) |
| Gateway down at start | `run_all.sh` warns and the agents use Home Assistant directly |
| Gateway down while running | The agents' device commands fail (`EXECUTION_FAILED`) until it is back |

## 7. Verification

- Unit tests: `services/` 116 (fake Home Assistant REST and WebSocket, fake OpenClaw; no HA or LLM
  needed in CI); agent
  plugin 19, including the Gateway/Collector settings and request-id propagation.
- `services/scripts/verify_integration.py` on the running system:
  1. every Agent Card's `owned_devices` equals `config/devices.yaml`;
  2. every agent's command on another agent's device, and `homeassistant.restart`, is refused (403);
  3. events from all five agents reached the Collector.
- Result on 2026-10-18 (local: Home Assistant, five agents, Gateway and Collector in Docker, after
  `scripts/scenario.sh`): all checks passed; the scenario results were unchanged with the Gateway in
  the path; `GET /flows` grouped each scenario request correctly (for example the delegated light
  request: desktop → orchestrator → room1, five events, accepted).
