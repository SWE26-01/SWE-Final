// What the screens may call through their server-side proxy (app/api/[service]/[...path]) and how
// it authenticates. A person's login session goes to the Agent Hub and Studio as their Bearer
// token (they check it); the Collector and the Gateway are read with the read-only dashboard
// token, only for a logged-in person (the Hub is asked first). Everything else is refused.

type Service = { url: () => string; session?: boolean; token?: () => string | undefined }

export const SERVICES: Record<string, Service> = {
  hub: { url: () => process.env.HUB_URL || "http://127.0.0.1:8400", session: true },
  studio: { url: () => process.env.STUDIO_URL || "http://127.0.0.1:8500", session: true },
  collector: { url: () => process.env.COLLECTOR_URL || "http://127.0.0.1:8200", token: () => process.env.DASHBOARD_TOKEN },
  gateway: { url: () => process.env.GATEWAY_URL || "http://127.0.0.1:8100", token: () => process.env.DASHBOARD_TOKEN },
}

const ID = "[a-z0-9][a-z0-9_-]{0,63}"
export const ALLOWED: Record<string, Record<string, RegExp[]>> = {
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
  gateway: { GET: [/^devices$/] }, // read only: the screens command no device
}

export function allowed(service: string, method: string, path: string): boolean {
  return Boolean(ALLOWED[service]?.[method]?.some((rule) => rule.test(path)))
}
