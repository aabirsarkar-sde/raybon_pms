"use client"

import { Factory, KeyRound, Loader2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** Token sign-in. With SSO this becomes a "Sign in with <organisation>" button. */
export function LoginForm({ next, expired }: { next: string; expired: boolean }) {
  const [token, setToken] = useState("")
  const [error, setError] = useState<string | null>(expired ? "Your session has ended. Please sign in again." : null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        setError(body?.detail ?? "Sign-in failed")
        return
      }
      window.location.href = next
    } catch {
      setError("Could not reach the server")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="w-full max-w-sm shadow-lg">
      <CardHeader className="gap-3">
        <div className="flex items-center gap-2 text-primary">
          <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Factory className="size-5" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">Plant Data</span>
        </div>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Use the access token issued to you by your administrator.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="token">Access token</Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="token"
                type="password"
                autoComplete="current-password"
                autoFocus
                className="pl-8"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="pdm_…"
                aria-invalid={error ? true : undefined}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy || !token.trim()}>
            {busy && <Loader2 className="animate-spin" />} Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
