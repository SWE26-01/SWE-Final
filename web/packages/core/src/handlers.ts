// Route handlers both apps mount: app/api/auth/[action]/route.ts and app/api/[service]/[...path]/route.ts.
import { SERVICES, allowed } from "./proxy.ts"
import { COOKIE, clearCookie, cookieHeader, forget, hubUrl, loginRequired, problem, whoIs } from "./session.ts"

type Params<T> = { params: Promise<T> }
/** What the handlers use of Next's request (NextRequest): the standard Request and its cookies. */
type NextRequest = Request & { cookies: { get(name: string): { value: string } | undefined } }

/** Server-side proxy: the browser never holds a service token. */
export async function proxy(request: NextRequest, { params }: Params<{ service: string; path?: string[] }>) {
  const { service, path: parts } = await params
  const path = (parts ?? []).join("/")
  const target = SERVICES[service]
  if (!target || !allowed(service, request.method, path)) return problem(404, "NOT_ALLOWED", "this call is not available on the screen")
  const session = request.cookies.get(COOKIE)?.value
  if (!session) return loginRequired()
  let token: string | undefined = session
  if (!target.session) {
    try {
      if (!(await whoIs(session))) return loginRequired()
    } catch (err) {
      return problem(502, "SERVICE_DOWN", `hub is not reachable (${(err as Error)?.name ?? "error"})`)
    }
    token = target.token?.()
    if (!token) return problem(503, "NO_TOKEN", `the screen server has no token for ${service}`)
  }
  const url = `${target.url().replace(/\/+$/, "")}/${path}${new URL(request.url).search}`
  const body = request.method === "POST" ? await request.text() : undefined
  try {
    const res = await fetch(url, {
      method: request.method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body,
      cache: "no-store",
      // Studio and a chat turn wait for an LLM
      signal: AbortSignal.timeout(path.endsWith("/chat") ? 180_000 : service === "studio" ? 90_000 : 15_000),
    })
    if (res.status === 401 && target.session) return loginRequired() // the session ended
    return new Response(await res.text(), {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") || "application/json", "cache-control": "no-store" },
    })
  } catch (err) {
    return problem(502, "SERVICE_DOWN", `${service} is not reachable (${(err as Error)?.name ?? "error"})`)
  }
}

/** Sign-up, login, logout and "who am I". The session token goes into an httpOnly cookie only. */
export async function authPost(request: NextRequest, { params }: Params<{ action: string }>) {
  const { action } = await params
  if (action === "logout") {
    const token = request.cookies.get(COOKIE)?.value
    if (token) {
      forget(token)
      await fetch(`${hubUrl()}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => null)
    }
    return new Response(null, { status: 204, headers: { "set-cookie": clearCookie() } })
  }
  if (action !== "login" && action !== "signup") return problem(404, "NOT_ALLOWED", "unknown action")
  let res: Response
  try {
    res = await fetch(`${hubUrl()}/auth/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    return problem(502, "SERVICE_DOWN", `hub is not reachable (${(err as Error)?.name ?? "error"})`)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return Response.json(data, { status: res.status })
  return Response.json({ user: data.user }, { status: res.status, headers: { "set-cookie": cookieHeader(data.token) } })
}

export async function authGet(request: NextRequest, { params }: Params<{ action: string }>) {
  const { action } = await params
  if (action !== "me") return problem(404, "NOT_ALLOWED", "unknown action")
  try {
    const user = await whoIs(request.cookies.get(COOKIE)?.value)
    return user ? Response.json(user, { headers: { "cache-control": "no-store" } }) : loginRequired()
  } catch (err) {
    return problem(502, "SERVICE_DOWN", `hub is not reachable (${(err as Error)?.name ?? "error"})`)
  }
}
