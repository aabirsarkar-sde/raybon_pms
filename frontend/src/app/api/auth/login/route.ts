import { startSession } from "@/lib/auth/session"
import { whoAmI } from "@/lib/server/pdm"

export async function POST(request: Request) {
  let token: unknown
  try {
    token = ((await request.json()) as { token?: unknown }).token
  } catch {
    return Response.json({ detail: "Invalid request" }, { status: 400 })
  }
  if (typeof token !== "string" || token.trim() === "" || token.length > 500) {
    return Response.json({ detail: "Enter your access token" }, { status: 400 })
  }
  const result = await whoAmI(token.trim())
  if (!result.ok) return Response.json({ detail: result.message }, { status: result.status })
  await startSession(token.trim())
  return Response.json(result.user)
}
