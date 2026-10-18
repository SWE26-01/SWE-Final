// One request_id follows a request through delegation, execution, energy saving and rules,
// so the Event Collector can show it as one flow.
import { describe, expect, it, vi } from "vitest";
import { createAgent, type Config } from "./agent.ts";
import { readData, taskResult } from "./a2a.ts";

const LIGHT = "input_boolean.room1_light";
const quiet = { info() {}, warn() {} };
const peers = { orchestrator: "http://orch", room1: "http://room1" };
const tokens = { orchestrator: "t-o", room1: "t-1", desktop: "t-d" };
const common = { peers, tokens, ha: { url: "http://ha", token: "x" }, collectorUrl: "http://collector", logFile: undefined };
const agents = {
  orchestrator: createAgent({ ...common, agentId: "orchestrator", role: "home", publicUrl: peers.orchestrator, owned: [], requestAcl: { desktop: ["*"] } } as Config, quiet),
  room1: createAgent({
    ...common, agentId: "room1", role: "room", publicUrl: peers.room1, owned: [LIGHT], requestAcl: { orchestrator: ["*"] },
    energySaving: [{ device: LIGHT, command: "TURN_OFF" }],
    rules: [{ field: "meeting_app_active", equals: true, actions: [{ device: LIGHT, command: "TURN_ON" }] }],
  } as Config, quiet),
};

const logged: Record<string, any>[] = [];
vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
  const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
  if (url.startsWith("http://collector")) return logged.push(JSON.parse(String(init!.body))), reply({});
  if (url.startsWith("http://ha")) return reply(url.includes("/states/") ? { state: "on" } : []);
  const id = url.startsWith(peers.room1) ? "room1" : "orchestrator";
  if (url.endsWith("agent-card.json")) return reply(agents[id].card);
  const rpc = JSON.parse(String(init!.body));
  const token = String((init!.headers as any).authorization).replace("Bearer ", "");
  const r = await agents[id].inbound(token, readData(rpc.params)!);
  return reply(taskResult(rpc.id, undefined, r, r.accepted));
});

const steps = (flow: string) =>
  logged.filter((e) => String(e.request_id).split("/")[0] === flow).map((e) => `${e.agent} ${e.dir} ${e.request_id}`);

describe("request ids", () => {
  it("a delegated request keeps its id down to the room's execution", async () => {
    await agents.orchestrator.inbound("t-d", { type: "device.control", request_id: "req-1", action: { device: LIGHT, command: "TURN_OFF" } });
    expect(steps("req-1")).toEqual([
      "orchestrator out req-1",
      "room1 exec req-1",
      "room1 in req-1",
      "orchestrator out-result req-1",
      "orchestrator in req-1",
    ]);
  });

  it("energy saving gives each room a child id", async () => {
    await agents.orchestrator.inbound("t-d", { type: "device.control", request_id: "req-2", action: { command: "ENERGY_SAVING" } });
    expect(steps("req-2")).toEqual(expect.arrayContaining(["room1 exec req-2/room1", "room1 in req-2/room1", "orchestrator in req-2"]));
  });

  it("a rule and the actions it triggers share one id", async () => {
    logged.length = 0;
    const update = { type: "context.update", source: "desktop", subject: "user1", sequence: 1, expires_at: new Date(Date.now() + 6e4).toISOString(), data: { meeting_app_active: true } };
    await agents.room1.inbound("t-d", update);
    await vi.waitFor(() => expect(logged.some((e) => e.dir === "rule")).toBe(true));
    const rule = logged.find((e) => e.dir === "rule")!;
    expect(rule.request_id).toBeTruthy();
    expect(steps(rule.request_id)).toEqual([`room1 exec ${rule.request_id}`, `room1 rule ${rule.request_id}`]);
  });
});
