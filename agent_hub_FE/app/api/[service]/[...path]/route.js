// Server-side proxy from the screen to the services. The browser never holds a service token: a
// person's calls to the Hub and Studio carry their login session (an httpOnly cookie, lib/session.js),
// and reads of the Collector and the Gateway use the read-only dashboard token (DASHBOARD_TOKEN), only
// for a logged-in person. Only the calls the screen makes pass; everything else is 404.

import { SERVICES, allowed } from "../../../../lib/proxy.js";
import { COOKIE, loginRequired, whoIs } from "../../../../lib/session.js";

const problem = (status, reason_code, message) => Response.json({ detail: { reason_code, message } }, { status });

async function forward(request, { params }) {
  const { service, path: parts } = await params;
  const path = (parts ?? []).join("/");
  const target = SERVICES[service];
  if (!target || !allowed(service, request.method, path)) {
    return problem(404, "NOT_ALLOWED", "this call is not available on the screen");
  }
  const session = request.cookies.get(COOKIE)?.value;
  if (!session) return loginRequired();
  let token = session;
  if (!target.session) {
    try {
      if (!(await whoIs(session))) return loginRequired();
    } catch (err) {
      return problem(502, "SERVICE_DOWN", `hub is not reachable (${err?.name ?? "error"})`);
    }
    token = target.token();
    if (!token) return problem(503, "NO_TOKEN", `the screen server has no token for ${service}`);
  }
  const url = `${target.url().replace(/\/+$/, "")}/${path}${new URL(request.url).search}`;
  const body = request.method === "POST" ? await request.text() : undefined;
  try {
    const res = await fetch(url, {
      method: request.method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(service === "studio" ? 90_000 : 15_000), // Studio waits for the LLM
    });
    if (res.status === 401 && target.session) return loginRequired(); // the session ended
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return problem(502, "SERVICE_DOWN", `${service} is not reachable (${err?.name ?? "error"})`);
  }
}

export { forward as GET, forward as POST, forward as DELETE };
