import { redirect } from "next/navigation"

import { AppShell } from "@/components/shell/app-shell"
import { ErrorState } from "@/components/common/states"
import { getAccessToken } from "@/lib/auth/session"
import { SessionProvider } from "@/lib/auth/session-context"
import { whoAmI } from "@/lib/server/pdm"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const token = await getAccessToken()
  if (!token) redirect("/login")
  const me = await whoAmI(token)
  if (!me.ok && me.status === 401) redirect("/login?expired=1")
  if (!me.ok) {
    return (
      <main className="grid min-h-svh place-items-center p-6">
        <ErrorState title="Plant Data is unavailable" message={me.message} retryHref="/" />
      </main>
    )
  }
  return (
    <SessionProvider user={me.user}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  )
}
