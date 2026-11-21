// Login sessions, on the screen's server only. The Hub gives a session token at sign-up or login;
// it lives in an httpOnly cookie, so page script never reads it. The proxy sends it to the Hub and
// Studio as the person's Bearer token, and checks it with the Hub before reading the Collector or
// the Gateway with the read-only dashboard token.

export const COOKIE = "ah_session";
export const MAX_AGE = 7 * 24 * 3600; // the Hub's session lifetime (agenthub/accounts.py)
const CACHE_MS = 20_000;
const seen = new Map(); // token -> {until, user}

export const hubUrl = () => (process.env.HUB_URL || "http://127.0.0.1:8400").replace(/\/+$/, "");

export function cookieHeader(token, maxAge = MAX_AGE) {
  const secure = process.env.SESSION_COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export const clearCookie = () => cookieHeader("", 0);

/** The person behind a session token ({id, name, role, member}), or null. Throws if the Hub is down. */
export async function whoIs(token) {
  if (!token) return null;
  const hit = seen.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const res = await fetch(`${hubUrl()}/auth/me`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (res.status === 401) {
    seen.delete(token);
    return null;
  }
  if (!res.ok) throw new Error(`hub answered ${res.status}`);
  const user = await res.json();
  if (seen.size > 1000) seen.clear();
  seen.set(token, { until: Date.now() + CACHE_MS, user });
  return user;
}

export const forget = (token) => seen.delete(token);

export const loginRequired = () =>
  Response.json({ detail: { reason_code: "LOGIN_REQUIRED", message: "log in first" } }, { status: 401 });
