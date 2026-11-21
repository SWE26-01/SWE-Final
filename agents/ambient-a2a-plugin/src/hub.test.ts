// With hubUrl: an agent made in Studio, connected in the Agent Hub, joins the home with a Hub-issued
// token that no other agent has in its config. The Hub says who it is, where it runs, what it may
// read and which devices it owns now.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, type Config } from "./agent.ts";
import { readData, taskResult } from "./a2a.ts";

const MODE = "input_select.room1_light_mode";
const HUB = "http://hub";
const GATEWAY = "http://gateway";
const quiet = { info() {}, warn() {} };
const tokens = { desktop: "t-d", orchestrator: "t-o", room1: "t-1" };
const peers = { desktop: "http://desktop", orchestrator: "http://orch", room1: "http://room1" };
const base = { peers, tokens, gatewayUrl: GATEWAY, hubUrl: HUB, logFile: undefined };

let hub: { tokens: Record<string, string>; peers: Record<string, string>; acl: Record<string, string[]>; owners: Record<string, string | null> };
let home: Record<string, string>;
let gatewayCalls: string[];
let agents: Record<string, ReturnType<typeof createAgent>>;

beforeEach(() => {
  hub = {
    tokens: { "hub-meeting": "meeting" },
    peers: { meeting: "http://meeting" },
    acl: { meeting: ["meeting_app_active"] },
    owners: { [MODE]: "meeting", "input_boolean.room1_light": "room1" },
  };
  home = { [MODE]: "normal" };
  gatewayCalls = [];
  agents = {
    desktop: createAgent({ ...base, agentId: "desktop", role: "external", publicUrl: peers.desktop, provides: ["meeting_app_active", "pc_state"], fieldAcl: { room1: ["meeting_app_active"] } } as Config, quiet),
    orchestrator: createAgent({ ...base, agentId: "orchestrator", role: "home", publicUrl: peers.orchestrator, owned: [], requestAcl: { desktop: [MODE] } } as Config, quiet),
    room1: createAgent({ ...base, agentId: "room1", role: "room", publicUrl: peers.room1, owned: [MODE, "input_boolean.room1_light"], requestAcl: { orchestrator: ["*"] } } as Config, quiet),
    // What Studio renders: its own token from the environment, not in `tokens`.
    meeting: createAgent({ ...base, agentId: "meeting", token: "hub-meeting", role: "room", space: "my_room", publicUrl: "http://meeting", owned: [MODE],
      requestAcl: { orchestrator: ["*"] }, rules: [{ field: "meeting_app_active", equals: true, actions: [{ device: MODE, command: "SET", value: "meeting" }] }] } as Config, quiet),
  };
  const byUrl: Record<string, string> = { ...Object.fromEntries(Object.entries(peers).map(([id, u]) => [u, id])), "http://meeting": "meeting" };

  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    const auth = String((init?.headers as any)?.authorization ?? "").replace("Bearer ", "");
    if (url.startsWith(HUB)) {
      if (![...Object.values(tokens), "hub-meeting"].includes(auth)) return reply({ detail: "unknown" }, 401);
      const path = url.slice(HUB.length);
      if (path === "/tokens/verify") {
        const id = hub.tokens[JSON.parse(String(init!.body)).token];
        return reply({ active: !!id, agent_id: id ?? null });
      }
      if (path === "/runtime/peers") return reply(hub.peers);
      if (path === "/runtime/acl/desktop") return reply(hub.acl);
      if (path === "/ownership") return reply(hub.owners);
      return reply({}, 404);
    }
    if (url.startsWith(GATEWAY)) {
      const m = url.match(/states\/(.+)$/);
      if (m) return reply({ state: home[m[1]] ?? "off" });
      gatewayCalls.push(`${auth} ${url.slice(GATEWAY.length)}`);
      const { entity_id, option } = JSON.parse(String(init!.body));
      home[entity_id] = option;
      return reply([]);
    }
    const root = url.replace(/\/(a2a\/v1|\.well-known\/agent-card\.json)$/, "");
    const a = agents[byUrl[root]];
    if (!a) throw new TypeError("fetch failed");
    if (url.endsWith("agent-card.json")) return reply(a.card);
    const rpc = JSON.parse(String(init!.body));
    const r = await a.inbound(auth, readData(rpc.params)!);
    return reply(taskResult(rpc.id, undefined, r, r.accepted));
  });
});

describe("Agent Hub", () => {
  it("a Studio agent subscribes with its Hub token and reacts to context, like a platform room", async () => {
    const sub = await agents.meeting.call("desktop", { type: "context.subscribe", subject: "user1", fields: ["meeting_app_active", "pc_state"] });
    expect(sub).toMatchObject({ granted_fields: ["meeting_app_active"], denied_fields: ["pc_state"] }); // what the user approved in the Hub

    const sent: any = await agents.desktop.publish({ meeting_app_active: true });
    expect(sent.delivered).toMatchObject([{ to: "meeting", accepted: true }]); // found at its Hub peer URL
    await vi.waitFor(() => expect(home[MODE]).toBe("meeting"));
    expect(gatewayCalls).toEqual(["hub-meeting /api/services/input_select/select_option"]); // its own token
  });

  it("a context permission revoked in the Hub stops the updates", async () => {
    await agents.meeting.call("desktop", { type: "context.subscribe", subject: "user1", fields: ["meeting_app_active"] });
    hub.acl = {};
    await new Promise((r) => setTimeout(r, 0));
    const sent: any = await afterHubTtl(5001, () => agents.desktop.publish({ meeting_app_active: true }));
    expect(sent.delivered).toEqual([]);
  });

  it("Home delegates to the agent connected as the owner now", async () => {
    const r = await agents.desktop.call("orchestrator", { type: "device.control", action: { device: MODE, command: "SET", value: "eco" } });
    expect(r).toMatchObject({ accepted: true, delegated_to: "meeting" });
    expect(home[MODE]).toBe("eco");

    hub.owners[MODE] = null; // the user disconnected it and connected nobody
    const none = await afterHubTtl(5001, () => agents.desktop.call("orchestrator", { type: "device.control", action: { device: MODE, command: "SET", value: "normal" } }));
    expect(none).toMatchObject({ accepted: false, reason_code: "NOT_OWNER" });
  });

  it("tokens the Hub does not know are refused", async () => {
    expect((await agents.room1.inbound("hub-stranger", { type: "device.control", action: { device: MODE, command: "TURN_ON" } })).reason_code).toBe("UNAUTHORIZED");
    hub.tokens = {}; // revoked; the cache keeps the old answer for at most its ttl
    expect((await afterHubTtl(5001, () => agents.room1.inbound("hub-meeting", { type: "context.query" }))).reason_code).toBe("UNAUTHORIZED");
  });
});

/** Run `fn` with the clock moved past the Hub cache ttl. */
async function afterHubTtl<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const spy = vi.spyOn(Date, "now").mockReturnValue(now + ms);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}
