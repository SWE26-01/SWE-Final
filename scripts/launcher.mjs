#!/usr/bin/env node
// Starts and stops the agents made in Studio, inside the agents container (scripts/run_agents.sh).
//
// The Agent Hub calls it when the user connects or disconnects such an agent (HUB_LAUNCHER_URL):
//   POST   /launch {id, token}   save the Hub-issued token in the agent's state dir, start it
//   DELETE /launch/<id>          stop it, delete the token
//   GET    /launch               which ones run
//   POST   /chat {id, port, session, message}   one chat turn with a running agent (the Hub's
//                                 "대화" tab), through its gateway's chat API with the gateway token
//   POST   /run/<id>             run a routine agent's routine now ("7:30으로 실행")
// Light agents (assistant and routine, agents/generated/<id>/agent.json) need no OpenClaw gateway:
// they run here. A chat is one OpenRouter call with their AGENTS.md as the system prompt; a routine
// sends one device.control per approved device to the Root Agent at its time (Asia/Seoul) with the
// agent's own Hub token, and reports both lines to the Event Collector. Their Agent Card is served
// without a token at GET /agents/<id>/.well-known/agent-card.json (public, like every card).
// Every call needs `Authorization: Bearer $RUNTIME_TOKEN`. The port is not published outside the
// Compose network. On start it brings back the agents whose token the Hub still accepts.
// The token lives only in $AGENT_HOME/state/<id>/agent-token (mode 600); scripts/oc.sh exports it
// as AGENT_SELF_TOKEN, which the Studio-rendered profile reads.
import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = process.env.AGENT_HOME || join(process.env.HOME ?? "/tmp", ".home-a2a");
const SECRET = process.env.RUNTIME_TOKEN ?? "";
const HUB = (process.env.AGENT_HUB_URL ?? "").replace(/\/+$/, "");
const PORT = Number(process.env.LAUNCHER_PORT || 18700);
const HOST = process.env.LAUNCHER_HOST || "127.0.0.1";
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
const PLATFORM_PORTS = new Set([18680, 18800, 18920, 19040, 19160, 19280]); // scripts/run_agents.sh
const chatPort = (port) => Number.isInteger(port) && (PLATFORM_PORTS.has(port) || (port >= 19400 && port < 25000));

const running = new Map(); // id -> child process
const wanted = new Set(); // ids that should run (restarted if they exit)

const say = (msg) => console.log(`[launcher] ${msg}`);
const tokenFile = (id) => join(HOME, "state", id, "agent-token");
const generated = (id, file) => join(ROOT, "agents", "generated", id, file);
const isLight = (id) => ID.test(id) && existsSync(generated(id, "agent.json"));
const isGenerated = (id) => ID.test(id) && (existsSync(generated(id, "openclaw.json5")) || isLight(id));

// --- Light agents ---------------------------------------------------------------------------
const LLM_KEY = process.env.OPENROUTER_API_KEY ?? "";
const LLM_URL = (process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const MODEL = (process.env.AGENT_MODEL || "openrouter/anthropic/claude-haiku-5.5").replace(/^openrouter\//, "");
const ROOT_URL = process.env.ROOT_AGENT_URL || "http://127.0.0.1:19040/plugins/a2a"; // agents/shared.json5
const COLLECTOR = (process.env.EVENT_COLLECTOR_URL ?? "").replace(/\/+$/, "");
const PUBLIC = process.env.LAUNCHER_PUBLIC_URL || `http://127.0.0.1:${PORT}`;
const light = new Map(); // id -> {spec, guide, token, sessions, timer, lastRun, last}

function startLight(id, token) {
  stopLight(id);
  const spec = JSON.parse(readFileSync(generated(id, "agent.json"), "utf8"));
  const guide = readFileSync(generated(id, "AGENTS.md"), "utf8");
  const agent = { spec, guide, token, sessions: new Map(), timer: null, lastRun: "", last: null };
  if (spec.routine) agent.timer = setInterval(() => void maybeRun(id), 20_000);
  light.set(id, agent);
  say(`started ${id} (light ${spec.kind}${spec.routine ? `, daily ${spec.routine.at}` : ""})`);
}

function stopLight(id) {
  const agent = light.get(id);
  if (!agent) return false;
  clearInterval(agent.timer);
  light.delete(id);
  return true;
}

const seoul = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
};

async function maybeRun(id) {
  const agent = light.get(id);
  const now = seoul();
  if (!agent || now.time !== agent.spec.routine.at || agent.lastRun === now.day) return;
  agent.lastRun = now.day;
  await runRoutine(id).catch((err) => say(`${id} routine failed: ${err}`));
}

async function report(agent, line) {
  if (!COLLECTOR) return;
  await fetch(`${COLLECTOR}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${agent.token}`, "content-type": "application/json" },
    body: JSON.stringify({ ts: new Date().toISOString(), agent: agent.spec.id, ...line }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => null);
}

/** One device.control per approved device, to the Root Agent, as this agent (its Hub token). */
async function runRoutine(id) {
  const agent = light.get(id);
  if (!agent?.spec.routine) return null;
  const request_id = randomUUID();
  const results = [];
  for (const action of agent.spec.routine.requests) {
    const data = { type: "device.control", request_id, requester: id, target: "root", action };
    await report(agent, { dir: "out", to: "root", type: data.type, request_id, action });
    try {
      const res = await fetch(`${ROOT_URL}/a2a/v1`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${agent.token}`, "A2A-Version": "1.0" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: randomUUID(),
          method: "SendMessage",
          params: { message: { messageId: randomUUID(), role: "ROLE_USER", parts: [{ data }] }, configuration: { returnImmediately: false } },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json();
      if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
      const r = body.result?.task?.artifacts?.[0]?.parts?.[0]?.data ?? {};
      await report(agent, { dir: "out-result", to: "root", type: data.type, request_id, accepted: r.accepted, reason_code: r.reason_code, message: r.message });
      results.push({ action, ...r });
    } catch (err) {
      await report(agent, { dir: "out-error", to: "root", type: data.type, request_id, action, error: String(err) });
      results.push({ action, accepted: false, reason_code: "PEER_UNREACHABLE", message: String(err) });
    }
  }
  agent.last = { at: new Date().toISOString(), request_id, results };
  say(`${id} routine ${request_id}: ${results.map((r) => r.reason_code).join(", ")}`);
  return { request_id, results };
}

/** One chat turn: OpenRouter with the agent's guide as the system prompt, a history per person. */
async function lightChat(id, session, message) {
  const agent = light.get(id);
  if (!LLM_KEY) return [503, { error: "OPENROUTER_API_KEY is not set" }];
  const history = agent.sessions.get(session) ?? [];
  let system = agent.guide;
  if (agent.spec.routine && agent.last) system += `\n\n## Last run\n${JSON.stringify(agent.last)}`;
  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${LLM_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, ...history, { role: "user", content: message }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) return [502, { error: `LLM answered ${res.status}` }];
  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content ?? "";
  agent.sessions.set(session, [...history, { role: "user", content: message }, { role: "assistant", content: reply }].slice(-20));
  return [200, { reply }];
}

function lightCard(id) {
  const { spec } = light.get(id);
  const url = `${PUBLIC}/agents/${id}`;
  const asks = spec.routine ? spec.routine.requests.map((r) => `request:${r.device}`) : [];
  return {
    name: spec.name,
    description: spec.description,
    version: "0.1.0",
    supportedInterfaces: [{ url: `${url}/a2a/v1`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [{ id: "chat", name: spec.name, description: spec.description || spec.name, tags: ["external", ...asks], inputModes: ["text/plain"], outputModes: ["text/plain"] }],
  };
}

function start(id) {
  if (isLight(id)) {
    wanted.add(id);
    return startLight(id, readFileSync(tokenFile(id), "utf8").trim());
  }
  if (running.has(id)) return;
  wanted.add(id);
  const log = join(ROOT, "logs", `${id}.log`);
  mkdirSync(dirname(log), { recursive: true });
  const child = spawn(join(ROOT, "scripts", "oc.sh"), [id, "gateway"], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const out = (chunk) => {
    appendFileSync(log, chunk);
    for (const line of String(chunk).split("\n")) if (line) process.stdout.write(`[${id}] ${line}\n`);
  };
  child.stdout.on("data", out);
  child.stderr.on("data", out);
  child.on("exit", (code, signal) => {
    running.delete(id);
    say(`${id} exited (${signal ?? code})`);
    if (wanted.has(id) && existsSync(tokenFile(id))) setTimeout(() => wanted.has(id) && start(id), 5000);
  });
  running.set(id, child);
  say(`started ${id} (pid ${child.pid})`);
}

function stop(id) {
  wanted.delete(id);
  rmSync(tokenFile(id), { force: true });
  if (stopLight(id)) return true;
  const child = running.get(id);
  if (!child) return false;
  child.kill("SIGTERM");
  setTimeout(() => running.get(id) === child && child.kill("SIGKILL"), 5000);
  return true;
}

function launch(id, token) {
  const file = tokenFile(id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, token, { mode: 0o600 });
  if (isLight(id)) return start(id);
  const child = running.get(id);
  if (child) {
    // A new token (reconnected): restart so the agent uses it.
    child.once("exit", () => start(id));
    child.kill("SIGTERM");
  } else start(id);
}

/** After a restart: start the agents whose token the Hub still accepts, forget the others. */
async function recover() {
  const dir = join(HOME, "state");
  const ids = existsSync(dir) ? readdirSync(dir).filter((id) => isGenerated(id) && existsSync(tokenFile(id))) : [];
  for (const id of ids) {
    for (;;) {
      try {
        const res = await fetch(`${HUB}/tokens/verify`, {
          method: "POST",
          headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
          body: JSON.stringify({ token: readFileSync(tokenFile(id), "utf8").trim() }),
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = await res.json();
        if (r.active && r.agent_id === id) start(id);
        else stop(id), say(`${id}: no longer connected in the Hub; token removed`);
        break;
      } catch (err) {
        say(`waiting for the Hub to check ${id}: ${err}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

const authorized = (req) => {
  const got = Buffer.from(String(req.headers.authorization ?? ""));
  const want = Buffer.from(`Bearer ${SECRET}`);
  return SECRET !== "" && got.length === want.length && timingSafeEqual(got, want);
};

const reply = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function body(req, limit = 4096) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > limit) throw new Error("body too large");
  }
  return JSON.parse(text || "{}");
}

/** One chat turn: the agent's own OpenClaw session per person (`user`), like scripts/say.sh. */
async function chat({ id, port, session, message }) {
  if (typeof message !== "string" || !message.trim() || message.length > 2000) return [400, { error: "bad message" }];
  const user = /^[A-Za-z0-9_:-]{1,80}$/.test(String(session)) ? session : "hub";
  if (light.has(id)) return lightChat(id, user, message);
  if (!ID.test(String(id)) || !chatPort(port)) return [400, { error: "bad agent" }];
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${GATEWAY_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "openclaw", user: `conv:${user}`, messages: [{ role: "user", content: message }] }),
    signal: AbortSignal.timeout(170_000),
  });
  if (!res.ok) return [502, { error: `${id} answered ${res.status}` }];
  const data = await res.json();
  return [200, { reply: data.choices?.[0]?.message?.content ?? "" }];
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? "").split("?")[0];
  const card = path.match(/^\/agents\/([^/]+)\/\.well-known\/agent(?:-card)?\.json$/);
  if (req.method === "GET" && card) {
    return light.has(card[1]) ? reply(res, 200, lightCard(card[1])) : reply(res, 404, { error: "not running" });
  }
  if (!authorized(req)) return reply(res, 401, { error: "unauthorized" });
  try {
    if (req.method === "GET" && path === "/launch") return reply(res, 200, { running: [...running.keys(), ...light.keys()] });
    const run = path.match(/^\/run\/([^/]+)$/);
    if (req.method === "POST" && run) {
      if (!light.get(run[1])?.spec.routine) return reply(res, 404, { error: "no routine" });
      return reply(res, 200, await runRoutine(run[1]));
    }
    if (req.method === "POST" && path === "/launch") {
      const { id, token } = await body(req);
      if (!isGenerated(id)) return reply(res, 404, { error: `no Studio agent ${JSON.stringify(id)} in agents/generated` });
      if (typeof token !== "string" || token.length < 16 || token.length > 200) return reply(res, 400, { error: "bad token" });
      launch(id, token);
      return reply(res, 200, { id, running: true });
    }
    if (req.method === "POST" && path === "/chat") {
      const [status, out] = await chat(await body(req, 16384));
      return reply(res, status, out);
    }
    const m = path.match(/^\/launch\/([^/]+)$/);
    if (req.method === "DELETE" && m && ID.test(m[1])) return reply(res, 200, { id: m[1], stopped: stop(m[1]) });
    return reply(res, 404, { error: "not found" });
  } catch (err) {
    return reply(res, 400, { error: String(err) });
  }
});

if (!SECRET) say("RUNTIME_TOKEN is not set: every call is refused");
server.listen(PORT, HOST, () => say(`listening on ${HOST}:${PORT}`));
if (HUB && SECRET) void recover();
for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, () => {
    for (const id of running.keys()) wanted.delete(id), running.get(id).kill("SIGTERM");
    process.exit(0);
  });
