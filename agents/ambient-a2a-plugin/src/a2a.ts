// A2A v1.0 JSON-RPC wire format (verified against a2a-sdk 1.2.2 protobuf JSON).
import { randomUUID } from "node:crypto";
import { EXT_URI, type Role } from "./core.ts";

export type CardInfo = {
  agentId: string;
  role: Role;
  space?: string;
  publicUrl: string; // e.g. http://127.0.0.1:19160/plugins/ambient
  owned: string[];
  provides: string[];
  energySaving?: unknown[];
};

const SKILLS: Record<Role, { id: string; name: string; description: string }[]> = {
  external: [
    { id: "context.subscribe", name: "Context subscription", description: "Subscribe to permitted user-context fields" },
    { id: "context.query", name: "Context query", description: "Read permitted user-context fields once" },
  ],
  room: [{ id: "device.control", name: "Room device control", description: "Policy-checked control of devices this room owns" }],
  home: [
    { id: "device.control", name: "Home device control", description: "Controls shared spaces; delegates room devices to their owner" },
    { id: "home.energy_saving", name: "Home energy saving", description: "Asks every room to save energy and aggregates results" },
  ],
};

export function agentCard(c: CardInfo) {
  return {
    name: c.agentId,
    description: `Ambient-A2A ${c.role} agent${c.space ? ` (${c.space})` : ""}`,
    version: "0.1.0",
    supportedInterfaces: [{ url: `${c.publicUrl}/a2a/v1`, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [
        {
          uri: EXT_URI,
          description: "Ambient-A2A: context sharing/subscription, room ownership, policy-aware control",
          required: true,
          params: { role: c.role, space: c.space ?? null, owned_devices: c.owned, provided_fields: c.provides, energy_saving: c.energySaving ?? [] },
        },
      ],
    },
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: "Bearer" } } },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: SKILLS[c.role].map((s) => ({ ...s, tags: ["ambient-a2a", c.role] })),
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
        artifacts: [{ artifactId: randomUUID(), name: "ambient-result", parts: [{ data: result }] }],
      },
    },
  };
}

export const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Send one Ambient-A2A DataPart to a peer and return the artifact's data. */
export async function send(peerUrl: string, token: string, data: Record<string, unknown>, timeoutMs = 15000): Promise<any> {
  const res = await fetch(`${peerUrl}/a2a/v1`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "A2A-Version": "1.0", "A2A-Extensions": EXT_URI },
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

export const extParams = (card: any) =>
  card?.capabilities?.extensions?.find((e: any) => e.uri === EXT_URI)?.params as
    | { role: Role; owned_devices: string[]; provided_fields: string[] }
    | undefined;
