/** Browser-side client. Every call goes through the /api/pdm proxy (never directly to FastAPI). */

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
    public requestId?: string,
  ) {
    super(describeDetail(status, detail))
    this.name = "ApiError"
  }

  get isConflict() {
    return this.status === 409
  }
}

type Params = Record<string, string | number | boolean | null | undefined>

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  body?: unknown
  params?: Params
  /** Sent as X-Change-Reason and stored in the audit log. */
  reason?: string | null
  signal?: AbortSignal
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v))
  }
  const url = `/api/pdm/${path.replace(/^\/+/, "")}${qs.size ? `?${qs}` : ""}`
  const headers: Record<string, string> = { "X-PDM-Client": "web" }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json"
  const reason = opts.reason?.trim()
  if (reason) headers["X-Change-Reason"] = reason

  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
      cache: "no-store",
    })
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e
    throw new ApiError(0, "Network error: the server could not be reached")
  }

  if (res.status === 401 && typeof window !== "undefined") {
    const next = window.location.pathname + window.location.search
    // Full reload on purpose: drops every cached query of the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?expired=1&next=${encodeURIComponent(next)}`
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail ?? data
    throw new ApiError(res.status, detail, res.headers.get("x-request-id") ?? undefined)
  }
  return data as T
}

/** Human-readable message for any API error body. */
export function describeDetail(status: number, detail: unknown): string {
  if (status === 0) return String(detail)
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: (string | number)[]; msg?: string }) => {
        const field = (d.loc ?? []).filter((p) => p !== "body").join(".")
        const msg = (d.msg ?? "").replace(/^Value error, /, "")
        return field ? `${field}: ${msg}` : msg
      })
      .join("; ")
  }
  if (detail && typeof detail === "object" && "message" in detail) return String((detail as { message: unknown }).message)
  if (typeof detail === "string" && detail) return detail
  const fallback: Record<number, string> = {
    403: "You don't have permission to do that",
    404: "Not found",
    409: "This record was changed by someone else",
    503: "The Plant Data API is unavailable",
  }
  return fallback[status] ?? `Request failed (${status})`
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return "Something went wrong"
}

/** X-Change-Reason travels in an HTTP header, which only carries Latin-1 text. */
export function reasonProblem(reason: string | null | undefined): string | null {
  if (!reason) return null
  if (reason.length > 500) return "Reason must be at most 500 characters"
  if (/[^\x20-\x7e\xa0-\xff]/.test(reason)) return "Reason can only contain Latin characters (no line breaks or emoji)"
  return null
}
