import { startSession } from "@/lib/auth/session"
import { apiLogin } from "@/lib/server/pdm"

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return Response.json({ detail: "Invalid request" }, { status: 400 })
  }
  const { username, password } = body
  if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) {
    return Response.json({ detail: "Enter your username and password" }, { status: 400 })
  }
  if (username.length > 100 || password.length > 256) {
    return Response.json({ detail: "Invalid username or password" }, { status: 401 })
  }
  const result = await apiLogin(username.trim(), password)
  if (!result.ok) return Response.json({ detail: result.message }, { status: result.status })
  await startSession(result.token, result.expiresAt)
  return Response.json(result.user)
}
