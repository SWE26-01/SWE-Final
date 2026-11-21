// Agent Hub client (services/agenthub): the connections the user approved, as the agents need them.
// - verify: who a Hub-issued bearer token belongs to (agents made in Studio call with one)
// - peers: A2A base URL of every connected agent
// - acl: which connected agents may read which of this agent's context fields
// - ownership: device -> the agent connected as its owner now
// Answers are cached for `ttlMs`, so a disconnect takes effect within that time.

export type HubClient = ReturnType<typeof hubClient>;

export function hubClient(url: string, token: string, ttlMs = 5000) {
  const cache = new Map<string, { at: number; value: unknown }>();

  async function cached<T>(key: string, fetchIt: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
    const value = await fetchIt();
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  async function req(path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${url}${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`Hub ${path}: HTTP ${res.status}`);
    return res.json();
  }

  return {
    /** Agent id of an active Hub-issued token, else undefined. */
    verify: (bearer: string) =>
      cached(`verify:${bearer}`, async () => {
        const r = await req("/tokens/verify", { token: bearer });
        return r?.active ? (r.agent_id as string) : undefined;
      }),
    peers: () => cached("peers", () => req("/runtime/peers") as Promise<Record<string, string>>),
    acl: (agentId: string) => cached(`acl:${agentId}`, () => req(`/runtime/acl/${encodeURIComponent(agentId)}`) as Promise<Record<string, string[]>>),
    ownership: () => cached("ownership", () => req("/ownership") as Promise<Record<string, string | null>>),
  };
}
