// Pages need a login: without the session cookie they go to /login first (the APIs answer 401
// themselves, and a session that ended is sent to /login by the page's own calls).
import { NextResponse, type NextRequest } from "next/server"

export function proxy(request: NextRequest) {
  if (request.cookies.has("ah_session")) return NextResponse.next()
  const url = new URL("/login", request.url)
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search)
  return NextResponse.redirect(url)
}

export const config = { matcher: ["/((?!login|api|_next|favicon.ico).*)"] }
