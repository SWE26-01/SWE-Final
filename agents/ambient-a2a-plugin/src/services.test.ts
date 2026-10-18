// Optional SWE-Final services: Device Gateway (gatewayUrl) and Event Collector (collectorUrl).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgent, type Config } from "./agent.ts";

const LIGHT = "input_boolean.room1_light";
const quiet = { info() {}, warn() {} };
const base = {
  agentId: "room1", role: "room", publicUrl: "http://room1", peers: {}, tokens: { room1: "t-1", desktop: "t-d" },
  ha: { url: "http://ha", token: "ha-token" }, owned: [LIGHT], logFile: undefined,
};
const room1 = (extra: Partial<Config> = {}) => createAgent({ ...base, ...extra } as Config, quiet);

let calls: { url: string; auth: string; body: any }[];
let collectorDown = false;

beforeEach(() => {
  calls = [];
  collectorDown = false;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (collectorDown && url.startsWith("http://collector")) throw new TypeError("fetch failed");
    calls.push({ url, auth: String((init?.headers as any)?.authorization), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(url.includes("/api/states/") ? { state: "off" } : []), { status: 200 });
  });
});

describe("optional services", () => {
  it("without them, devices go straight to Home Assistant with the HA token", async () => {
    // shared.json5 turns an unset env var into "", which must mean "off" just like undefined
    expect((await room1({ gatewayUrl: "", collectorUrl: "" }).control({ device: LIGHT, command: "TURN_ON" })).accepted).toBe(true);
    expect(calls).toEqual([{ url: "http://ha/api/services/input_boolean/turn_on", auth: "Bearer ha-token", body: { entity_id: LIGHT } }]);
  });

  it("with gatewayUrl, devices go through the Gateway with the agent's own token", async () => {
    expect((await room1({ gatewayUrl: "http://gateway/" }).control({ device: LIGHT, command: "TURN_ON" })).accepted).toBe(true);
    expect(calls).toEqual([{ url: "http://gateway/api/services/input_boolean/turn_on", auth: "Bearer t-1", body: { entity_id: LIGHT } }]);
  });

  it("with collectorUrl, every log line is also posted to the Collector as this agent", async () => {
    await room1({ collectorUrl: "http://collector" }).control({ device: LIGHT, command: "TURN_ON" });
    const posted = calls.filter((c) => c.url === "http://collector/events");
    expect(posted).toHaveLength(1);
    expect(posted[0].auth).toBe("Bearer t-1");
    expect(posted[0].body).toMatchObject({ agent: "room1", dir: "exec", accepted: true, reason_code: "OK", action: { device: LIGHT } });
  });

  it("a Collector that is down never breaks the agent", async () => {
    collectorDown = true;
    const r = await room1({ collectorUrl: "http://collector" }).control({ device: LIGHT, command: "TURN_ON" });
    expect(r.accepted).toBe(true);
  });
});
