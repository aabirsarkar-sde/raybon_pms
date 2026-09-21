import { NextResponse, type NextRequest } from "next/server"

// Keep in sync with lib/auth/session.ts (proxy code must not import server-only modules).
const SESSION_COOKIE = "pdm_session"

/** Send visitors without a session to /login. The session itself is validated in the app layout. */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next()
  const url = request.nextUrl.clone()
  url.pathname = "/login"
  url.search = ""
  const next = request.nextUrl.pathname + request.nextUrl.search
  if (next !== "/") url.searchParams.set("next", next)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|favicon.ico).*)"],
}
