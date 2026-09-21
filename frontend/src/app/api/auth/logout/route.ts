import { endSession, getAccessToken } from "@/lib/auth/session"
import { apiLogout } from "@/lib/server/pdm"

export async function POST() {
  const token = await getAccessToken()
  if (token) await apiLogout(token)
  await endSession()
  return new Response(null, { status: 204 })
}
