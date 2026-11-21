// Server-side proxy from the screen to the services. The browser never holds a token: the home
// user's token (HOME_USER_TOKEN) and the read-only dashboard token (DASHBOARD_TOKEN) are added
// here, on the server. Only the calls the screen makes pass; everything else is 404.

import { SERVICES, allowed } from "../../../../lib/proxy.js";

async function forward(request, { params }) {
  const { service, path: parts } = await params;
  const path = (parts ?? []).join("/");
  const target = SERVICES[service];
  if (!target || !allowed(service, request.method, path)) {
    return Response.json({ detail: { reason_code: "NOT_ALLOWED", message: "this call is not available on the screen" } }, { status: 404 });
  }
  const token = target.token();
  if (!token) {
    return Response.json({ detail: { reason_code: "NO_TOKEN", message: `the screen server has no token for ${service}` } }, { status: 503 });
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
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return Response.json(
      { detail: { reason_code: "SERVICE_DOWN", message: `${service} is not reachable (${err?.name ?? "error"})` } },
      { status: 502 },
    );
  }
}

export { forward as GET, forward as POST, forward as DELETE };
