// What the screen may call through app/api/[service]/[...path] (the server-side proxy), and how it
// authenticates. Kept apart from the route file so it can be tested on its own (lib/proxy.test.mjs).
// `session`: the person's login session goes along as their Bearer token (the Hub and Studio check
// it). Otherwise the read-only dashboard token is used, after the session was checked with the Hub.

export const SERVICES = {
  hub: { url: () => process.env.HUB_URL || "http://127.0.0.1:8400", session: true },
  studio: { url: () => process.env.STUDIO_URL || "http://127.0.0.1:8500", session: true },
  collector: { url: () => process.env.COLLECTOR_URL || "http://127.0.0.1:8200", token: () => process.env.DASHBOARD_TOKEN },
  gateway: { url: () => process.env.GATEWAY_URL || "http://127.0.0.1:8100", token: () => process.env.DASHBOARD_TOKEN },
};

const ID = "[a-z0-9][a-z0-9_-]{0,63}";
export const ALLOWED = {
  hub: {
    GET: [/^agents$/, new RegExp(`^agents/${ID}$`), new RegExp(`^agents/${ID}/activity$`), /^spaces$/, /^connections$/],
    POST: [/^connections$/, /^agents\/discover$/, new RegExp(`^agents/${ID}/(refresh|share|star|chat|run)$`)],
    DELETE: [/^connections\/[a-f0-9]{1,64}$/, new RegExp(`^agents/${ID}$`)],
  },
  studio: {
    GET: [/^drafts$/, /^drafts\/[a-f0-9]{1,64}$/],
    POST: [/^drafts$/, /^drafts\/[a-f0-9]{1,64}\/(answer|approve)$/],
  },
  collector: { GET: [/^agents$/, /^flows$/, /^flows\/[A-Za-z0-9_-]{1,128}$/] }, // read only
  gateway: { GET: [/^devices$/] }, // read only: the dashboard token commands nothing
};

export function allowed(service, method, path) {
  return Boolean(ALLOWED[service]?.[method]?.some((rule) => rule.test(path)));
}
