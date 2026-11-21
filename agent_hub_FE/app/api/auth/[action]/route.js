// Sign-up, login, logout and "who am I" for the screen. The Hub makes the session; its token goes
// into an httpOnly cookie here and is never returned to page script.

import { clearCookie, COOKIE, cookieHeader, forget, hubUrl, loginRequired, whoIs } from "../../../../lib/session.js";

const down = (err) =>
  Response.json({ detail: { reason_code: "SERVICE_DOWN", message: `hub is not reachable (${err?.name ?? "error"})` } }, { status: 502 });

export async function POST(request, { params }) {
  const { action } = await params;
  if (action === "logout") {
    const token = request.cookies.get(COOKIE)?.value;
    if (token) {
      forget(token);
      await fetch(`${hubUrl()}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => null);
    }
    return new Response(null, { status: 204, headers: { "set-cookie": clearCookie() } });
  }
  if (action !== "login" && action !== "signup") {
    return Response.json({ detail: { reason_code: "NOT_ALLOWED", message: "unknown action" } }, { status: 404 });
  }
  let res;
  try {
    res = await fetch(`${hubUrl()}/auth/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return down(err);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return Response.json(data, { status: res.status });
  return Response.json({ user: data.user }, { status: res.status, headers: { "set-cookie": cookieHeader(data.token) } });
}

export async function GET(request, { params }) {
  const { action } = await params;
  if (action !== "me") return Response.json({ detail: { reason_code: "NOT_ALLOWED" } }, { status: 404 });
  try {
    const user = await whoIs(request.cookies.get(COOKIE)?.value);
    return user ? Response.json(user, { headers: { "cache-control": "no-store" } }) : loginRequired();
  } catch (err) {
    return down(err);
  }
}
