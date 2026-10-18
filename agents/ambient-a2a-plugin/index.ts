// OpenClaw plugin entry: exposes the Ambient-A2A endpoint + agent tools for one agent profile.
import type { IncomingMessage, ServerResponse } from "node:http";
import { Type } from "typebox";
import { createAgent, type Config } from "./src/agent.ts";
import { readData, rpcError, taskResult } from "./src/a2a.ts";

const BASE = "/plugins/ambient";
const MAX_BODY = 1 << 20;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) return reject(new Error("body too large")), req.destroy();
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }], details: v });

const ActionParams = {
  device: Type.Optional(Type.String({ description: "HA entity id, e.g. input_boolean.living_tv_muted. Omit for ENERGY_SAVING." })),
  command: Type.Union([Type.Literal("TURN_ON"), Type.Literal("TURN_OFF"), Type.Literal("SET"), Type.Literal("ENERGY_SAVING")]),
  value: Type.Optional(Type.Union([Type.String(), Type.Number()], { description: "For SET: option (input_select) or number" })),
};

export default {
  id: "ambient-a2a",
  name: "Ambient-A2A",
  description: "Ambient-A2A smart-home extension over A2A v1.0 (context sharing, subscription, ownership, policy)",
  register(api: any) {
    const cfg = api.pluginConfig as Config;
    if (!cfg?.agentId) return api.logger.warn("ambient-a2a: plugins.entries.ambient-a2a.config.agentId missing; disabled");
    const agent = createAgent(cfg, api.logger);

    api.registerHttpRoute({
      path: BASE,
      auth: "plugin", // bearer tokens are verified per peer in agent.inbound
      match: "prefix",
      async handler(req: IncomingMessage, res: ServerResponse) {
        const path = (req.url ?? "").split("?")[0];
        if (req.method === "GET" && (path === `${BASE}/.well-known/agent-card.json` || path === `${BASE}/.well-known/agent.json`))
          return json(res, 200, agent.card), true;
        if (req.method !== "POST" || path !== `${BASE}/a2a/v1`) return json(res, 404, { error: "not found" }), true;

        let rpc: any;
        try {
          rpc = JSON.parse(await readBody(req));
        } catch {
          return json(res, 200, rpcError(null, -32700, "parse error")), true;
        }
        if (rpc.method !== "SendMessage" && rpc.method !== "message/send")
          return json(res, 200, rpcError(rpc.id, rpc.method === "GetTask" ? -32004 : -32601, `unsupported method ${rpc.method}`)), true;
        const data = readData(rpc.params);
        if (!data) return json(res, 200, rpcError(rpc.id, -32602, "Ambient-A2A requires a DataPart")), true;

        const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
        const result = await agent.inbound(token, data);
        res.setHeader("A2A-Extensions", "https://github.com/nsu102/A2A-agents/spec/ambient-a2a/v1");
        // PARTIAL = some sub-actions ran, so the task completed; per-device verdicts live in result.results.
        const completed = result.accepted || result.reason_code === "PARTIAL";
        return json(res, 200, taskResult(rpc.id, rpc.params?.message?.contextId, result, completed)), true;
      },
    });

    let stopSubs = () => {};
    api.registerService({
      id: "ambient-a2a-subscriptions",
      start: () => void (stopSubs = agent.startSubscriptions()),
      stop: () => stopSubs(),
    });

    const tool = (name: string, description: string, parameters: any, run: (p: any) => Promise<unknown>) =>
      api.registerTool({ name, label: name, description, parameters: Type.Object(parameters), execute: async (_id: string, p: any) => text(await run(p)) });

    tool("ambient_status", "Show this agent's devices, received context and subscriptions.", {}, () => agent.status());

    tool(
      "ambient_request",
      "Ask another Ambient-A2A agent to control a device (device.control). The target agent decides; the reply says accepted or rejected with reason_code.",
      { target: Type.String({ description: `Agent id: ${Object.keys(cfg.peers).join(", ")}` }), ...ActionParams, reason_code: Type.Optional(Type.String()) },
      ({ target, reason_code, ...action }) => agent.call(target, { type: "device.control", request_id: crypto.randomUUID(), target, action, reason_code }),
    );

    if (cfg.role === "external")
      // Flat params (one per provided field): models tend to call {"meeting_app_active": true} directly; a nested {fields:{...}} shape cost a failed call + retry.
      tool(
        "ambient_publish",
        "Publish the user's current state to subscribed agents. Pass only the fields that changed. Never include raw personal data (titles, locations).",
        Object.fromEntries((cfg.provides ?? []).map((f) => [f, Type.Optional(Type.Union([Type.String(), Type.Boolean(), Type.Number()]))])),
        (fields) => agent.publish(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))),
      );

    if (cfg.role !== "external") {
      tool(
        "ambient_control",
        `Control a device. Owned: ${(cfg.owned ?? []).join(", ")}.${cfg.role === "home" ? " Room devices are delegated to their room agent, which may reject." : " Non-owned devices are rejected."}`,
        ActionParams,
        (action) => agent.control(action),
      );
      tool(
        "ambient_query",
        "Ask an external agent (desktop, smartphone) for the user's current context fields (context.query). Only permitted fields are returned.",
        { target: Type.String(), fields: Type.Array(Type.String()) },
        ({ target, fields }) => agent.call(target, { type: "context.query", subject: cfg.subject ?? "user1", fields }),
      );
    }

    if (cfg.role === "home")
      tool("ambient_home_energy_saving", "Ask every room agent to save energy and aggregate per-room results. Query external agents first if unsure.", {}, () =>
        agent.energySavingAll(),
      );
  },
};
