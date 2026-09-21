import "server-only"

import type { User } from "@/lib/api/types"

/** Base URL of the FastAPI service. Server-side only; never exposed to the browser. */
export function apiBaseUrl(): string {
  return (process.env.PDM_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "")
}

export type WhoAmI =
  | { ok: true; user: User }
  | { ok: false; status: number; message: string }

export type LoginResult =
  | { ok: true; token: string; expiresAt: string; user: User }
  | { ok: false; status: number; message: string }

/** Username/password sign-in against the API; returns a session token. */
export async function apiLogin(username: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetch(`${apiBaseUrl()}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    })
    const body = (await res.json().catch(() => null)) as { token?: string; expires_at?: string; user?: User; detail?: unknown } | null
    if (res.ok && body?.token && body.user && body.expires_at) {
      return { ok: true, token: body.token, expiresAt: body.expires_at, user: body.user }
    }
    const message = typeof body?.detail === "string" ? body.detail : res.status === 422 ? "Enter your username and password" : `Sign-in failed (${res.status})`
    return { ok: false, status: res.status, message }
  } catch {
    return { ok: false, status: 503, message: "The Plant Data API is unreachable" }
  }
}

/** Revoke the API session (best effort). */
export async function apiLogout(token: string): Promise<void> {
  try {
    await fetch(`${apiBaseUrl()}/api/v1/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
  } catch {
    /* the cookie is cleared regardless */
  }
}

/** Validate a credential against the API. */
export async function whoAmI(token: string): Promise<WhoAmI> {
  try {
    const res = await fetch(`${apiBaseUrl()}/api/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (res.ok) return { ok: true, user: (await res.json()) as User }
    return { ok: false, status: res.status, message: res.status === 401 ? "Invalid or expired token" : `API error ${res.status}` }
  } catch {
    return { ok: false, status: 503, message: "The Plant Data API is unreachable" }
  }
}
