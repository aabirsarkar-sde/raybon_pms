import "server-only"

import type { User } from "@/lib/api/types"

/** Base URL of the FastAPI service. Server-side only; never exposed to the browser. */
export function apiBaseUrl(): string {
  return (process.env.PDM_API_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "")
}

export type WhoAmI =
  | { ok: true; user: User }
  | { ok: false; status: number; message: string }

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
