"use client"

import { Eye, EyeOff, Factory, Loader2, LockKeyhole, User } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** Username / password sign-in. Accounts and roles are managed by admins on the Users page. */
export function LoginForm({ next, expired }: { next: string; expired: boolean }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
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
        body: JSON.stringify({ username, password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null
        setError(body?.detail ?? "Sign-in failed")
        setPassword("")
        return
      }
      // Full navigation so the signed-in layout loads fresh.
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
        <CardDescription>Use the username and password given to you by your administrator.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                className="pl-8"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                name="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                className="pr-9 pl-8"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
              <button
                type="button"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="login-error">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy || !username.trim() || !password}>
            {busy && <Loader2 className="animate-spin" />} Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
