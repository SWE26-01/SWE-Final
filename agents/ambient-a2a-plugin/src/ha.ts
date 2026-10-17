// Home Assistant REST client, hard-limited to the entities this agent owns.
// ponytail: HA has no per-entity ACL, so this whitelist is the "device gateway" check; put a proxy in front of HA if a second, independent check is needed.
import type { Action } from "./core.ts";

export function haClient(url: string, token: string, owned: string[]) {
  const req = async (path: string, body?: unknown) => {
    const res = await fetch(`${url}/api/${path}`, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HA ${path}: HTTP ${res.status}`);
    return res.json();
  };

  return {
    /** Reads any entity state (policies may depend on sensors this agent doesn't own). */
    async state(entity: string): Promise<string> {
      return ((await req(`states/${entity}`)) as any).state;
    },

    async apply({ device, command, value }: Action) {
      if (!device || !owned.includes(device)) throw new Error(`refusing to control non-owned entity ${device}`);
      const domain = device.split(".")[0];
      const [service, extra] =
        command === "TURN_ON" ? ["turn_on", {}]
        : command === "TURN_OFF" ? ["turn_off", {}]
        : domain === "input_select" ? ["select_option", { option: String(value) }]
        : domain === "input_number" ? ["set_value", { value: Number(value) }]
        : [null, {}];
      if (!service) throw new Error(`unsupported ${command} for ${device}`);
      await req(`services/${domain}/${service}`, { entity_id: device, ...extra });
    },
  };
}
