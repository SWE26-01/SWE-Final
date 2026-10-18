// Ambient-A2A agent runtime: inbound message handling, delegation, automation, subscriptions.
// SDK-free so it can be driven by the OpenClaw plugin entry (index.ts) or by tests.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type Action, type Decision, type Policy, type Role, type Rule, type ContextUpdate,
  ContextStore, Publisher, checkPolicy, checkRequester, deny, firedRules, ok, route,
} from "./core.ts";
import { agentCard, extParams, fetchCard, send } from "./a2a.ts";
import { haClient } from "./ha.ts";

export type Config = {
  agentId: string;
  role: Role;
  space?: string;
  subject?: string; // external: whose context this is
  publicUrl: string;
  peers: Record<string, string>; // agentId -> base URL
  tokens: Record<string, string>; // agentId -> bearer token. ponytail: one token per agent shared via env; per-pair tokens or mTLS if agents are mutually untrusted
  owned?: string[];
  provides?: string[];
  fieldAcl?: Record<string, string[]>;
  requestAcl?: Record<string, string[]>;
  subscribeTo?: Record<string, string[]>;
  policies?: Policy[];
  rules?: Rule[];
  energySaving?: Action[];
  ha?: { url: string; token: string };
  // Optional services (SWE-Final services/). Empty = off.
  gatewayUrl?: string; // Device Gateway: HA calls go here with this agent's own token; it re-checks ownership
  collectorUrl?: string; // Event Collector: every log line is also POSTed here
  ttlSec?: number;
  logFile?: string;
};

type Result = Decision & Record<string, unknown>;

export function createAgent(cfg: Config, logger: { info(m: string): void; warn(m: string): void } = console) {
  const owned = cfg.owned ?? [];
  const myToken = cfg.tokens[cfg.agentId];
  const gatewayUrl = cfg.gatewayUrl?.replace(/\/+$/, "");
  const collectorUrl = cfg.collectorUrl?.replace(/\/+$/, "");
  const ha = cfg.ha ? haClient(gatewayUrl || cfg.ha.url, gatewayUrl ? myToken : cfg.ha.token, owned) : null;
  const store = new ContextStore();
  const pub = new Publisher(cfg.agentId, cfg.subject ?? "user1", cfg.provides ?? [], cfg.fieldAcl ?? {});
  const ownership: Record<string, string> = {}; // device -> owning agent (home only, filled from Agent Cards)
  const rooms = new Set<string>();
  const byToken = new Map(Object.entries(cfg.tokens).map(([id, t]) => [t, id]));

  const log = (e: Record<string, unknown>) => {
    const line = { ts: new Date().toISOString(), agent: cfg.agentId, ...e };
    logger.info(`[ambient] ${JSON.stringify(line)}`);
    if (collectorUrl)
      void fetch(`${collectorUrl}/events`, {
        method: "POST",
        headers: { authorization: `Bearer ${myToken}`, "content-type": "application/json" },
        body: JSON.stringify(line),
        signal: AbortSignal.timeout(2000),
      }).catch(() => {}); // the Collector being down must never break the agent
    if (!cfg.logFile) return;
    try {
      mkdirSync(dirname(cfg.logFile), { recursive: true });
      appendFileSync(cfg.logFile, JSON.stringify(line) + "\n");
    } catch (err) {
      logger.warn(`[ambient] log write failed: ${err}`);
    }
  };

  async function call(peer: string, data: Record<string, unknown>): Promise<any> {
    const url = cfg.peers[peer];
    if (!url) return deny("UNKNOWN_PEER", `no URL for ${peer}`);
    log({ dir: "out", to: peer, type: data.type, request_id: data.request_id, action: data.action, fields: data.fields });
    try {
      const r = await send(url, myToken, { requester: cfg.agentId, ...data });
      log({ dir: "out-result", to: peer, type: data.type, request_id: data.request_id, accepted: r?.accepted, reason_code: r?.reason_code });
      return r;
    } catch (err) {
      log({ dir: "out-error", to: peer, type: data.type, request_id: data.request_id, error: String(err) });
      return deny("PEER_UNREACHABLE", `${peer}: ${err}`);
    }
  }

  /** Home: learn device ownership from room Agent Cards (Agent Discovery). */
  async function discover() {
    if (cfg.role !== "home") return;
    for (const [id, url] of Object.entries(cfg.peers)) {
      if (id === cfg.agentId) continue;
      try {
        const p = extParams(await fetchCard(url));
        if (p?.role !== "room") continue;
        rooms.add(id);
        for (const d of p.owned_devices) ownership[d] = id;
      } catch {
        /* peer down; retried on next control request */
      }
    }
  }

  async function local(action: Action, request_id?: string): Promise<Result> {
    const r = await execute(action);
    log({ dir: "exec", request_id, action, accepted: r.accepted, reason_code: r.reason_code, message: r.message });
    return r;
  }

  async function execute(action: Action): Promise<Result> {
    if (!ha) return deny("NOT_OWNER", `${cfg.agentId} owns no devices`);
    try {
      const states: Record<string, string> = {};
      for (const p of cfg.policies ?? []) states[p.when.entity] ??= await ha.state(p.when.entity);
      const violation = checkPolicy(action, cfg.policies ?? [], states);
      if (violation) return { ...violation, device: action.device };
      await ha.apply(action);
      return { ...ok(`${action.command} ${action.device}${action.value !== undefined ? `=${action.value}` : ""}`), device: action.device };
    } catch (err) {
      return { ...deny("EXECUTION_FAILED", String(err)), device: action.device };
    }
  }

  const aggregate = (results: Result[], message: string): Result => ({
    accepted: results.length > 0 && results.every((r) => r.accepted),
    reason_code: results.every((r) => r.accepted) ? "OK" : "PARTIAL",
    message,
    results,
  });

  /** Per-room requests get child ids `<request_id>/<room>`, so the whole job can be traced as one request. */
  async function energySavingAll(onBehalfOf?: string, request_id: string = randomUUID()): Promise<Result> {
    if (!rooms.size) await discover();
    const mine = await Promise.all((cfg.energySaving ?? []).map((a) => local(a, request_id)));
    const remote = await Promise.all(
      [...rooms].map(async (room) => ({
        room,
        ...(await call(room, { type: "device.control", request_id: `${request_id}/${room}`, target: room, on_behalf_of: onBehalfOf, action: { command: "ENERGY_SAVING" }, reason_code: "ENERGY_SAVING" })),
      })),
    );
    return aggregate([...mine.map((r) => ({ room: cfg.agentId, ...r })), ...remote], "home energy saving");
  }

  /** Execute or delegate. requester === self means the call came from our own rules/LLM. */
  async function control(action: Action, requester = cfg.agentId, request_id: string = randomUUID()): Promise<Result> {
    if (action.command === "ENERGY_SAVING") {
      if (cfg.role === "home") return energySavingAll(requester, request_id);
      return aggregate(await Promise.all((cfg.energySaving ?? []).map((a) => local(a, request_id))), `${cfg.agentId} energy saving`);
    }
    if (!action.device) return deny("BAD_REQUEST", "device required");
    if (cfg.role === "home" && !ownership[action.device] && !owned.includes(action.device)) await discover();
    const owner = route(action.device, owned, ownership);
    if (owner === "self") return local(action, request_id);
    if (owner && cfg.role === "home") {
      const r = await call(owner, { type: "device.control", request_id, target: owner, on_behalf_of: requester, action });
      return { ...r, delegated_to: owner };
    }
    return deny("NOT_OWNER", `${cfg.agentId} does not own ${action.device}`);
  }

  async function runRules(data: Record<string, unknown>) {
    for (const rule of firedRules(cfg.rules ?? [], data)) {
      for (const a of rule.actions) {
        const request_id = randomUUID(); // one id for the rule and everything it triggers
        const r = "macro" in a ? await energySavingAll(undefined, request_id) : await control(a, cfg.agentId, request_id);
        log({ dir: "rule", request_id, rule: `${rule.field}=${JSON.stringify(rule.equals)}`, action: a, accepted: r.accepted, reason_code: r.reason_code, message: r.message });
      }
    }
  }

  /** Inbound DataPart from an authenticated peer. Returns [result, accepted]. */
  async function handle(requester: string, data: Record<string, any>): Promise<Result> {
    if (data.requester && data.requester !== requester) return deny("UNAUTHORIZED", "requester does not match credentials");
    switch (data.type) {
      case "context.subscribe": {
        const r = pub.subscribe(requester, data.fields ?? []);
        return { accepted: r.granted.length > 0, reason_code: r.reason_code, message: `granted ${r.granted.join(",") || "nothing"}`, granted_fields: r.granted, denied_fields: r.denied };
      }
      case "context.unsubscribe":
        pub.subs.delete(requester);
        return ok("unsubscribed");
      case "context.query": {
        const r = pub.query(requester, data.fields ?? []);
        return { accepted: r.granted.length > 0, message: "context snapshot", ...r };
      }
      case "context.update": {
        const u = data as ContextUpdate;
        if (u.source !== requester) return deny("UNAUTHORIZED", "source does not match credentials");
        const r = store.accept(u);
        if (r.accepted) void runRules(u.data);
        return r;
      }
      case "device.control": {
        const action = data.action as Action;
        const acl = checkRequester(requester, action, cfg.requestAcl ?? {});
        if (acl) return { request_id: data.request_id, ...acl };
        return { request_id: data.request_id, ...(await control(action, requester, data.request_id)) };
      }
      default:
        return deny("BAD_REQUEST", `unknown type ${data.type}`);
    }
  }

  async function inbound(token: string | undefined, data: Record<string, any>): Promise<Result> {
    const requester = token ? byToken.get(token) : undefined;
    const r = requester ? await handle(requester, data) : deny("UNAUTHORIZED", "unknown bearer token");
    log({ dir: "in", from: requester ?? "?", type: data.type, request_id: data.request_id, on_behalf_of: data.on_behalf_of, action: data.action, fields: data.fields, accepted: r.accepted, reason_code: r.reason_code, message: r.message });
    return r;
  }

  async function publish(changes: Record<string, unknown>) {
    const updates = pub.publish(changes, cfg.ttlSec ?? 3600);
    const sent = await Promise.all(Object.entries(updates).map(async ([to, u]) => ({ to, ...(await call(to, u)) })));
    return { sequence: pub.sequence, expires_at: pub.expires_at, delivered: sent };
  }

  /** Subscribe to configured external peers, retrying until each accepts (peers may start later). */
  function startSubscriptions(): () => void {
    const pending = new Map(Object.entries(cfg.subscribeTo ?? {}));
    const tick = async () => {
      for (const [peer, fields] of pending) {
        const r = await call(peer, { type: "context.subscribe", subject: cfg.subject ?? "user1", fields });
        if (r?.reason_code !== "PEER_UNREACHABLE") pending.delete(peer);
      }
      if (!pending.size) clearInterval(timer);
    };
    // ponytail: subscriptions live in the publisher's memory; a restarted external agent forgets them until this agent restarts too.
    const timer = setInterval(tick, 5000);
    void tick();
    void discover();
    return () => clearInterval(timer);
  }

  async function status() {
    const devices: Record<string, string> = {};
    if (ha) for (const d of owned) devices[d] = await ha.state(d).catch((e) => `error: ${e}`);
    return {
      agentId: cfg.agentId, role: cfg.role, space: cfg.space, devices,
      context: store.fields,
      published: cfg.role === "external" ? { sequence: pub.sequence, expires_at: pub.expires_at, state: pub.state, subscribers: Object.fromEntries(pub.subs) } : undefined,
      known_ownership: cfg.role === "home" ? ownership : undefined,
    };
  }

  const card = agentCard({ agentId: cfg.agentId, role: cfg.role, space: cfg.space, publicUrl: cfg.publicUrl, owned, provides: cfg.provides ?? [], energySaving: cfg.energySaving });

  return { card, inbound, control, publish, status, call, energySavingAll, startSubscriptions };
}
