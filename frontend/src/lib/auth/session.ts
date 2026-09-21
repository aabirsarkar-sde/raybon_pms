import "server-only"

import { cookies } from "next/headers"

/**
 * Session storage for the API credential.
 *
 * Today the credential is a PDM API bearer token pasted on /login. To move to
 * the organisation's SSO, replace this module (and app/api/auth/*): store the
 * OIDC session instead and make `getAccessToken()` return the access token the
 * API accepts. Nothing else in the app reads the credential.
 */
export const SESSION_COOKIE = "pdm_session"
const MAX_AGE_SECONDS = 60 * 60 * 12 // 12 h

export async function getAccessToken(): Promise<string | null> {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value ?? null
}

export async function startSession(token: string) {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function endSession() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}
