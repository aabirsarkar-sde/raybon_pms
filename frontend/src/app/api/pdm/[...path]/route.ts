/**
 * Backend-for-frontend proxy: the browser talks only to this route, which
 * forwards to the FastAPI service with the session's bearer token.
 *
 *   /api/pdm/plants/1?x=y  ->  ${PDM_API_URL}/api/v1/plants/1?x=y
 */
import type { NextRequest } from "next/server"

import { endSession, getAccessToken } from "@/lib/auth/session"
import { apiBaseUrl } from "@/lib/server/pdm"

const SEGMENT = /^[A-Za-z0-9_-]+$/
const FORWARD_REQUEST_HEADERS = ["content-type", "content-length", "x-change-reason", "x-request-id"]
// content-disposition and etag are needed so document downloads keep their file
// name and can be revalidated; the rest are the API's own cache/sniffing rules.
const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-disposition",
  "cache-control",
  "etag",
  "x-content-type-options",
  "x-request-id",
]
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"])

type Ctx = { params: Promise<{ path: string[] }> }

async function forward(request: NextRequest, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params
  if (!path.every((s) => SEGMENT.test(s))) {
    return Response.json({ detail: "Invalid path" }, { status: 400 })
  }
  // CSRF defence: a cross-site form/fetch cannot set this custom header without CORS approval.
  if (MUTATING.has(request.method) && request.headers.get("x-pdm-client") !== "web") {
    return Response.json({ detail: "Missing X-PDM-Client header" }, { status: 403 })
  }
  const token = await getAccessToken()
  if (!token) return Response.json({ detail: "Not signed in" }, { status: 401 })

  const headers = new Headers({ Authorization: `Bearer ${token}` })
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = request.headers.get(h)
    if (v !== null) headers.set(h, v)
  }

  const url = `${apiBaseUrl()}/api/v1/${path.join("/")}${request.nextUrl.search}`
  let upstream: Response
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers,
      // Streamed, not read as text: document uploads are binary and can be large,
      // and `duplex: "half"` is what fetch requires to send a request body stream.
      body: MUTATING.has(request.method) ? request.body : undefined,
      duplex: "half",
      cache: "no-store",
    } as RequestInit & { duplex: "half" })
  } catch {
    return Response.json({ detail: "The Plant Data API is unreachable" }, { status: 503 })
  }

  if (upstream.status === 401) await endSession()

  const out = new Headers()
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h)
    if (v !== null) out.set(h, v)
  }
  // Streamed back so a large drawing is not held in memory on the way to the browser.
  const body = upstream.status === 204 ? null : upstream.body
  return new Response(body, { status: upstream.status, headers: out })
}

export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
