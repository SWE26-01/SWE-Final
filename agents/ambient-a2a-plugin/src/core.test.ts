import { describe, expect, it, vi } from "vitest";
import { ContextStore, Publisher, checkPolicy, checkRequester, route, type Policy } from "./core.ts";
import { createAgent, type Config } from "./agent.ts";
import { readData, taskResult } from "./a2a.ts";

const sleep: Policy = {
  when: { entity: "input_boolean.room2_sleep_mode", state: "on" },
  deny: { devices: ["input_boolean.room2_ac"], commands: ["TURN_OFF"] },
  message: "Temperature regulation must remain enabled.",
};

describe("core", () => {
  it("requester ACL matches device, command or *", () => {
    const acl = { desktop: ["input_boolean.living_tv_muted"], smartphone: ["ENERGY_SAVING"], orchestrator: ["*"] };
    expect(checkRequester("desktop", { device: "input_boolean.living_tv_muted", command: "TURN_ON" }, acl)).toBeNull();
    expect(checkRequester("desktop", { device: "input_boolean.room2_ac", command: "TURN_OFF" }, acl)?.reason_code).toBe("UNAUTHORIZED");
    expect(checkRequester("smartphone", { command: "ENERGY_SAVING" }, acl)).toBeNull();
    expect(checkRequester("orchestrator", { device: "x", command: "TURN_ON" }, acl)).toBeNull();
    expect(checkRequester("stranger", { device: "x", command: "TURN_ON" }, acl)?.accepted).toBe(false);
  });

  it("routes by ownership", () => {
    expect(route("a", ["a"], {})).toBe("self");
    expect(route("b", ["a"], { b: "room1" })).toBe("room1");
    expect(route("c", ["a"], {})).toBeNull();
  });

  it("safety policy only applies when its condition holds", () => {
    const off = { device: "input_boolean.room2_ac", command: "TURN_OFF" as const };
    expect(checkPolicy(off, [sleep], { "input_boolean.room2_sleep_mode": "on" })?.reason_code).toBe("SAFETY_POLICY");
    expect(checkPolicy(off, [sleep], { "input_boolean.room2_sleep_mode": "off" })).toBeNull();
    expect(checkPolicy({ ...off, command: "TURN_ON" }, [sleep], { "input_boolean.room2_sleep_mode": "on" })).toBeNull();
  });

  it("drops stale and expired context", () => {
    const s = new ContextStore();
    const u = (sequence: number, exp: number) => ({ type: "context.update" as const, source: "desktop", subject: "user1", sequence, expires_at: new Date(exp).toISOString(), data: { pc_state: sequence } });
    const now = Date.now();
    expect(s.accept(u(2, now + 1e5), now).accepted).toBe(true);
    expect(s.accept(u(1, now + 1e5), now).reason_code).toBe("STALE");
    expect(s.accept(u(3, now - 1), now).reason_code).toBe("STALE");
    expect(s.value("pc_state", now)).toBe(2);
  });

  it("publisher filters fields per subscriber and never leaks unprovided fields", () => {
    const p = new Publisher("desktop", "user1", ["meeting_app_active", "pc_state"], { room1: ["meeting_app_active", "pc_state"], orchestrator: ["meeting_app_active"] });
    expect(p.subscribe("orchestrator", ["meeting_app_active", "pc_state"])).toMatchObject({ granted: ["meeting_app_active"], denied: ["pc_state"], reason_code: "FIELD_NOT_ALLOWED" });
    p.subscribe("room1", ["meeting_app_active", "pc_state"]);
    const out = p.publish({ meeting_app_active: true, pc_state: "ACTIVE" }, 60);
    expect(out.orchestrator.data).toEqual({ meeting_app_active: true });
    expect(out.room1.data).toEqual({ meeting_app_active: true, pc_state: "ACTIVE" });
    expect(out.room1.sequence).toBeGreaterThan(Date.now() - 1000);
    expect(p.publish({ pc_state: "IDLE" }, 60, 0).room1.sequence).toBe(out.room1.sequence + 1); // monotonic even if the clock goes back
    expect(() => p.publish({ meeting_title: "secret" }, 60)).toThrow();
    expect(p.query("orchestrator", ["pc_state"]).values).toEqual({});
  });

  it("wire: reads v1.0 and v0.3 DataParts", () => {
    expect(readData({ message: { parts: [{ text: "hi" }, { data: { type: "x" } }] } })).toEqual({ type: "x" });
    expect(readData({ message: { parts: [{ kind: "data", data: { type: "y" } }] } })).toEqual({ type: "y" });
    expect(taskResult(1, "c", { a: 1 }, false).result.task.status.state).toBe("TASK_STATE_REJECTED");
  });
});

// In-process network: peer URLs dispatch to agents' inbound(), HA URL hits a fake state map.
describe("flows", () => {
  const HA = "http://ha";
  const tokens = { desktop: "t-d", orchestrator: "t-o", room1: "t-1", room2: "t-2" };
  const peers = { desktop: "http://desktop", orchestrator: "http://orch", room1: "http://room1", room2: "http://room2" };
  const ha: Record<string, string> = {
    "input_boolean.living_tv_muted": "off", "input_select.room1_light_mode": "normal",
    "input_boolean.room1_light": "on", "input_boolean.room2_ac": "on", "input_boolean.room2_sleep_mode": "on",
  };
  const base = { peers, tokens, ha: { url: HA, token: "x" }, logFile: undefined };
  const quiet = { info() {}, warn() {} };
  const agents: Record<string, ReturnType<typeof createAgent>> = {
    orchestrator: createAgent({ ...base, agentId: "orchestrator", role: "home", publicUrl: peers.orchestrator, owned: ["input_boolean.living_tv_muted"],
      requestAcl: { desktop: ["input_boolean.living_tv_muted", "input_select.room1_light_mode"], smartphone: ["ENERGY_SAVING"] } } as Config, quiet),
    room1: createAgent({ ...base, agentId: "room1", role: "room", publicUrl: peers.room1, owned: ["input_select.room1_light_mode", "input_boolean.room1_light"],
      requestAcl: { orchestrator: ["*"] }, energySaving: [{ device: "input_boolean.room1_light", command: "TURN_OFF" }] } as Config, quiet),
    room2: createAgent({ ...base, agentId: "room2", role: "room", publicUrl: peers.room2, owned: ["input_boolean.room2_ac", "input_boolean.room2_sleep_mode"],
      requestAcl: { orchestrator: ["*"] }, policies: [sleep], energySaving: [{ device: "input_boolean.room2_ac", command: "TURN_OFF" }] } as Config, quiet),
    desktop: createAgent({ ...base, agentId: "desktop", role: "external", publicUrl: peers.desktop, provides: ["meeting_app_active"], fieldAcl: { orchestrator: ["meeting_app_active"] } } as Config, quiet),
  };
  const byUrl = Object.fromEntries(Object.entries(peers).map(([id, u]) => [u, id]));

  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.startsWith(HA)) {
      const m = url.match(/states\/(.+)$/);
      if (m) return reply({ state: ha[m[1]] });
      const { entity_id, option } = JSON.parse(String(init!.body));
      ha[entity_id] = url.endsWith("turn_on") ? "on" : url.endsWith("turn_off") ? "off" : option;
      return reply([]);
    }
    const [root, rest] = [url.replace(/\/(a2a\/v1|\.well-known\/agent-card\.json)$/, ""), url];
    const a = agents[byUrl[root]];
    if (rest.endsWith("agent-card.json")) return reply(a.card);
    const rpc = JSON.parse(String(init!.body));
    const token = String((init!.headers as any).authorization).replace("Bearer ", "");
    const r = await a.inbound(token, readData(rpc.params)!);
    return reply(taskResult(rpc.id, undefined, r, r.accepted));
  });

  it("A: desktop → home (ACL ok) → room1 delegated and executed", async () => {
    const r = await agents.desktop.call("orchestrator", { type: "device.control", action: { device: "input_select.room1_light_mode", command: "SET", value: "meeting" } });
    expect(r).toMatchObject({ accepted: true, delegated_to: "room1" });
    expect(ha["input_select.room1_light_mode"]).toBe("meeting");
    expect((await agents.desktop.call("orchestrator", { type: "device.control", action: { device: "input_boolean.living_tv_muted", command: "TURN_ON" } })).accepted).toBe(true);
    expect(ha["input_boolean.living_tv_muted"]).toBe("on");
  });

  it("A: home rejects unauthorized requester before reaching the room", async () => {
    const r = await agents.desktop.call("orchestrator", { type: "device.control", action: { device: "input_boolean.room2_ac", command: "TURN_OFF" } });
    expect(r.reason_code).toBe("UNAUTHORIZED");
    expect(ha["input_boolean.room2_ac"]).toBe("on");
  });

  it("room cannot control a device it does not own", async () => {
    expect((await agents.room1.control({ device: "input_boolean.living_tv_muted", command: "TURN_OFF" })).reason_code).toBe("NOT_OWNER");
  });

  it("energy saving: room1 accepts, room2 rejects by safety policy, home aggregates", async () => {
    const r: any = await agents.orchestrator.energySavingAll();
    const byRoom = Object.fromEntries(r.results.map((x: any) => [x.room, x]));
    expect(byRoom.room1.accepted).toBe(true);
    expect(byRoom.room2.results[0].reason_code).toBe("SAFETY_POLICY");
    expect(r.reason_code).toBe("PARTIAL");
    expect(ha["input_boolean.room1_light"]).toBe("off");
    expect(ha["input_boolean.room2_ac"]).toBe("on");
  });

  it("B: home queries desktop and only gets permitted fields", async () => {
    await agents.desktop.publish({ meeting_app_active: true });
    const r = await agents.orchestrator.call("desktop", { type: "context.query", fields: ["meeting_app_active", "pc_state"] });
    expect(r.values).toEqual({ meeting_app_active: true });
    expect(r.denied).toEqual(["pc_state"]);
  });

  it("rejects bad tokens and spoofed requesters", async () => {
    expect((await agents.room1.inbound("nope", { type: "context.query" })).reason_code).toBe("UNAUTHORIZED");
    expect((await agents.room1.inbound("t-d", { type: "device.control", requester: "orchestrator", action: { command: "TURN_ON" } })).reason_code).toBe("UNAUTHORIZED");
  });
});
