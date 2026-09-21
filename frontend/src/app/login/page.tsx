import type { Metadata } from "next"

import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Sign in" }

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams
  const next = typeof sp.next === "string" && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/"
  return (
    <main className="grid min-h-svh place-items-center bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_60%)] p-4">
      <LoginForm next={next} expired={sp.expired === "1"} />
    </main>
  )
}
