// Pure Ambient-A2A decision logic (no I/O) — everything here is unit-tested.

export const EXT_URI = "https://github.com/nsu102/A2A-agents/spec/ambient-a2a/v1";

export type Role = "external" | "home" | "room";
export type Command = "TURN_ON" | "TURN_OFF" | "SET" | "ENERGY_SAVING";
export type Action = { device?: string; command: Command; value?: string | number };
export type Decision = { accepted: boolean; reason_code: string; message: string };
export type Policy = {
  when: { entity: string; state: string };
  deny: { devices: string[]; commands?: Command[] };
  reason_code?: string;
  message: string;
};
export type ContextUpdate = {
  type: "context.update";
  source: string;
  subject: string;
  sequence: number;
  expires_at: string;
  data: Record<string, unknown>;
};

export const ok = (message = "OK"): Decision => ({ accepted: true, reason_code: "OK", message });
export const deny = (reason_code: string, message: string): Decision => ({ accepted: false, reason_code, message });

// --- Extension 3: requester ACL. Entries match a device id, a command, or "*".
export function checkRequester(requester: string, action: Action, acl: Record<string, string[]>): Decision | null {
  const allowed = acl[requester] ?? [];
  if (allowed.includes("*") || allowed.includes(action.command) || (action.device && allowed.includes(action.device))) return null;
  return deny("UNAUTHORIZED", `${requester} may not request ${action.command} ${action.device ?? ""}`.trim());
}

// --- Extension 3: who executes this device. "self" | owner agentId | null
export function route(device: string, owned: string[], ownership: Record<string, string>): string | null {
  if (owned.includes(device)) return "self";
  return ownership[device] ?? null;
}

// --- Extension 4: space policy. states = current HA states of the `when` entities.
export function checkPolicy(action: Action, policies: Policy[], states: Record<string, string>): Decision | null {
  for (const p of policies) {
    if (states[p.when.entity] !== p.when.state) continue;
    if (!action.device || !p.deny.devices.includes(action.device)) continue;
    if (p.deny.commands && !p.deny.commands.includes(action.command)) continue;
    return deny(p.reason_code ?? "SAFETY_POLICY", p.message);
  }
  return null;
}

// --- Extension 1: receiver side. Drops out-of-order or expired updates.
export class ContextStore {
  private last: Record<string, number> = {};
  fields: Record<string, { value: unknown; source: string; expires_at: string }> = {};

  accept(u: ContextUpdate, now = Date.now()): Decision {
    if (u.sequence <= (this.last[u.source] ?? -1)) return deny("STALE", `sequence ${u.sequence} <= ${this.last[u.source]}`);
    if (Date.parse(u.expires_at) <= now) return deny("STALE", `expired at ${u.expires_at}`);
    this.last[u.source] = u.sequence;
    for (const [k, v] of Object.entries(u.data)) this.fields[k] = { value: v, source: u.source, expires_at: u.expires_at };
    return ok();
  }

  value(field: string, now = Date.now()): unknown {
    const f = this.fields[field];
    return f && Date.parse(f.expires_at) > now ? f.value : undefined;
  }
}

// --- Extensions 1+2: publisher side (external agents). Only `provides` fields ever leave the agent.
export class Publisher {
  sequence = 0;
  state: Record<string, unknown> = {};
  expires_at = new Date(0).toISOString();
  subs = new Map<string, string[]>();

  constructor(private self: string, private subject: string, private provides: string[], private acl: Record<string, string[]>) {}

  private allowed(requester: string, fields: string[]) {
    const ok = new Set((this.acl[requester] ?? []).filter((f) => this.provides.includes(f)));
    return { granted: fields.filter((f) => ok.has(f)), denied: fields.filter((f) => !ok.has(f)) };
  }

  subscribe(requester: string, fields: string[]) {
    const r = this.allowed(requester, fields);
    if (r.granted.length) this.subs.set(requester, r.granted);
    else this.subs.delete(requester);
    return { ...r, reason_code: r.denied.length ? "FIELD_NOT_ALLOWED" : "OK" };
  }

  query(requester: string, fields: string[], now = Date.now()) {
    const r = this.allowed(requester, fields);
    const fresh = Date.parse(this.expires_at) > now;
    const values = Object.fromEntries(r.granted.map((f) => [f, fresh ? this.state[f] ?? null : null]));
    return { ...r, values, sequence: this.sequence, expires_at: this.expires_at, reason_code: r.denied.length ? "FIELD_NOT_ALLOWED" : "OK" };
  }

  /** Returns one update per subscriber, filtered to its granted ∩ changed fields. */
  publish(changes: Record<string, unknown>, ttlSec: number, now = Date.now()): Record<string, ContextUpdate> {
    const unknown = Object.keys(changes).filter((k) => !this.provides.includes(k));
    if (unknown.length) throw new Error(`not a provided field: ${unknown.join(", ")}`);
    Object.assign(this.state, changes);
    this.sequence += 1;
    this.expires_at = new Date(now + ttlSec * 1000).toISOString();
    const out: Record<string, ContextUpdate> = {};
    for (const [requester, granted] of this.subs) {
      const data = Object.fromEntries(granted.filter((f) => f in changes).map((f) => [f, changes[f]]));
      if (Object.keys(data).length)
        out[requester] = { type: "context.update", source: this.self, subject: this.subject, sequence: this.sequence, expires_at: this.expires_at, data };
    }
    return out;
  }
}

// --- automation: rules fire when a just-accepted update sets field == equals.
export type Rule = { field: string; equals: unknown; actions: (Action | { macro: "energy_saving" })[] };
export const firedRules = (rules: Rule[], data: Record<string, unknown>) =>
  rules.filter((r) => r.field in data && data[r.field] === r.equals);
