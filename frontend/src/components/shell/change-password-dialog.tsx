"use client"

import { Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api, errorMessage } from "@/lib/api/client"

export const MIN_PASSWORD = 8

export function newPasswordProblem(pw: string, confirm: string, username?: string): string | null {
  if (!pw) return null
  if (pw.length < MIN_PASSWORD) return `At least ${MIN_PASSWORD} characters`
  if (username && pw.toLowerCase() === username.toLowerCase()) return "Must not be the same as the username"
  if (confirm && pw !== confirm) return "Passwords do not match"
  return null
}

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const problem = newPasswordProblem(next, confirm)
  const ready = current && next && confirm && !problem

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await api("auth/change-password", { method: "POST", body: { current_password: current, new_password: next } })
      toast.success("Password changed", { description: "You have been signed out on your other devices." })
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Other devices signed in to your account will be signed out.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pw-current">Current password</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pw-new">New password</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pw-confirm">Repeat new password</Label>
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {(problem || error) && (
            <p role="alert" className="text-sm text-destructive">
              {problem ?? error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !ready}>
              {busy && <Loader2 className="animate-spin" />} Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
