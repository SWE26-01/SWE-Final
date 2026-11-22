// A2A v1.0 JSON-RPC wire format (verified against a2a-sdk 1.2.2 protobuf JSON). Standard A2A only:
// the Agent Card uses the standard fields and nothing more. What an agent owns or shares is told by
// the standard `skills[].tags` (see cardInfo), and requests are a standard DataPart.
import { randomUUID } from "node:crypto";
import type { Role } from "./core.ts";

export type CardInfo = {
  agentId: string;
  role: Role;
  space?: string;
  publicUrl: string; // e.g. http://127.0.0.1:19160/plugins/a2a
  owned: string[];
  provides: string[];
};

const JSON_IO = { inputModes: ["application/json"], outputModes: ["application/json"] };

function skills(c: CardInfo) {
  const tags = [c.role, ...(c.space ? [`space:${c.space}`] : [])];
  const devices = c.owned.map((d) => `device:${d}`);
  const fields = c.provides.map((f) => `field:${f}`);
  const where = c.space ? ` in ${c.space}` : "";
  const list = {
    external: [
      { id: "context.subscribe", name: "Context subscription", description: "Subscribe to permitted user-context fields", tags: [...tags, ...fields] },
      { id: "context.query", name: "Context query", description: "Read permitted user-context fields once", tags: [...tags, ...fields] },
    ],
    room: [{ id: "device.control", name: "Room device control", description: `Policy-checked control of the devices this agent owns${where}`, tags: [...tags, ...devices] }],
    home: [
      { id: "device.control", name: "Home device control", description: `Controls the devices${where}; delegates room devices to their owner`, tags: [...tags, ...devices] },
      { id: "home.energy_saving", name: "Home energy saving", description: "Asks every room to save energy and aggregates results", tags },
    ],
  }[c.role];
  return list.map((s) => ({ ...s, ...JSON_IO }));
}

export function agentCard(c: CardInfo) {
  return {
    name: c.agentId,
    description: `Smart-home ${c.role} agent${c.space ? ` (${c.space})` : ""}`,
    version: "0.1.0",
    supportedInterfaces: [{ url: `${c.publicUrl}/a2a/v1`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    capabilities: { streaming: false, pushNotifications: false },
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: skills(c),
  };
}

/** Role, space, owned devices and shared fields, read back from a card's standard skill tags. */
export function cardInfo(card: any): { role?: Role; space?: string; owned_devices: string[]; provided_fields: string[] } {
  const tags = new Set<string>((card?.skills ?? []).flatMap((s: any) => (Array.isArray(s?.tags) ? s.tags : [])));
  const after = (prefix: string) => [...tags].filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length));
  return {
    role: (["home", "room", "external"] as Role[]).find((r) => tags.has(r)),
    space: after("space:")[0],
    owned_devices: after("device:"),
    provided_fields: after("field:"),
  };
}

/** First DataPart of a SendMessage request (also tolerates v0.3 `kind:"data"` parts). */
export function readData(params: any): Record<string, any> | null {
  const p = (params?.message?.parts ?? []).find((p: any) => p?.data && typeof p.data === "object");
  return p?.data ?? null;
}

export function taskResult(rpcId: unknown, contextId: string | undefined, result: Record<string, unknown>, accepted: boolean) {
  return {
    jsonrpc: "2.0",
    id: rpcId,
    result: {
      task: {
        id: randomUUID(),
        contextId: contextId ?? randomUUID(),
        status: { state: accepted ? "TASK_STATE_COMPLETED" : "TASK_STATE_REJECTED", timestamp: new Date().toISOString() },
        artifacts: [{ artifactId: randomUUID(), name: "a2a-result", parts: [{ data: result }] }],
      },
    },
  };
}

export const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Send one DataPart request to a peer and return the artifact's data. */
export async function send(peerUrl: string, token: string, data: Record<string, unknown>, timeoutMs = 15000): Promise<any> {
  const res = await fetch(`${peerUrl}/a2a/v1`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "A2A-Version": "1.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "SendMessage",
      params: { message: { messageId: randomUUID(), role: "ROLE_USER", parts: [{ data }] }, configuration: { returnImmediately: false } },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body: any = await res.json();
  if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
  return body.result?.task?.artifacts?.[0]?.parts?.[0]?.data ?? body.result;
}

export async function fetchCard(peerUrl: string): Promise<any> {
  const res = await fetch(`${peerUrl}/.well-known/agent-card.json`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`card ${peerUrl}: HTTP ${res.status}`);
  return res.json();
}
