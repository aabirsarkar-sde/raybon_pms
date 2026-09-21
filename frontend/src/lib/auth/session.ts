import "server-only"

import { cookies } from "next/headers"

/**
 * Session storage for the API credential.
 *
 * The credential is the API session token issued by POST /auth/login (username +
 * password); it is kept in an httpOnly cookie and never reaches browser JavaScript. To move to
 * the organisation's SSO, replace this module (and app/api/auth/*): store the
 * OIDC session instead and make `getAccessToken()` return the access token the
 * API accepts. Nothing else in the app reads the credential.
 */
export const SESSION_COOKIE = "pdm_session"
const MAX_AGE_SECONDS = 60 * 60 * 12 // 12 h

/**
 * Secure (HTTPS-only) cookies in production. Browsers drop Secure cookies on plain-HTTP
 * sites (Safari even on localhost), so an HTTP-only test server must set PDM_COOKIE_SECURE=false.
 */
function cookieSecure(): boolean {
  const v = process.env.PDM_COOKIE_SECURE
  return v === undefined ? process.env.NODE_ENV === "production" : v !== "false"
}

export async function getAccessToken(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value ?? null
}

export async function startSession(token: string, expiresAt?: string) {
  const store = await cookies()
  const untilExpiry = expiresAt ? Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000) : MAX_AGE_SECONDS
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(60, Math.min(untilExpiry, MAX_AGE_SECONDS)),
  })
}

export async function endSession() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
