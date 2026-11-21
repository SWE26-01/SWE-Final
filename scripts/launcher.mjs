#!/usr/bin/env node
// Starts and stops the agents made in Studio, inside the agents container (scripts/run_agents.sh).
//
// The Agent Hub calls it when the user connects or disconnects such an agent (HUB_LAUNCHER_URL):
//   POST   /launch {id, token}   save the Hub-issued token in the agent's state dir, start it
//   DELETE /launch/<id>          stop it, delete the token
//   GET    /launch               which ones run
// Every call needs `Authorization: Bearer $RUNTIME_TOKEN`. The port is not published outside the
// Compose network. On start it brings back the agents whose token the Hub still accepts.
// The token lives only in $AMBIENT_HOME/state/<id>/agent-token (mode 600); scripts/oc.sh exports it
// as AMBIENT_AGENT_TOKEN, which the Studio-rendered profile reads.
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = process.env.AMBIENT_HOME || join(process.env.HOME ?? "/tmp", ".ambient-a2a");
const SECRET = process.env.RUNTIME_TOKEN ?? "";
const HUB = (process.env.AMBIENT_HUB_URL ?? "").replace(/\/+$/, "");
const PORT = Number(process.env.LAUNCHER_PORT || 18700);
const HOST = process.env.LAUNCHER_HOST || "127.0.0.1";
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const running = new Map(); // id -> child process
const wanted = new Set(); // ids that should run (restarted if they exit)

const say = (msg) => console.log(`[launcher] ${msg}`);
const tokenFile = (id) => join(HOME, "state", id, "agent-token");
const isGenerated = (id) => ID.test(id) && existsSync(join(ROOT, "agents", "generated", id, "openclaw.json5"));

function start(id) {
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

async function body(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 4096) throw new Error("body too large");
  }
  return JSON.parse(text || "{}");
}

const server = createServer(async (req, res) => {
  if (!authorized(req)) return reply(res, 401, { error: "unauthorized" });
  const path = (req.url ?? "").split("?")[0];
  try {
    if (req.method === "GET" && path === "/launch") return reply(res, 200, { running: [...running.keys()] });
    if (req.method === "POST" && path === "/launch") {
      const { id, token } = await body(req);
      if (!isGenerated(id)) return reply(res, 404, { error: `no Studio agent ${JSON.stringify(id)} in agents/generated` });
      if (typeof token !== "string" || token.length < 16 || token.length > 200) return reply(res, 400, { error: "bad token" });
      launch(id, token);
      return reply(res, 200, { id, running: true });
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
