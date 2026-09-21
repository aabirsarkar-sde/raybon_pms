"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Loader2, LockOpen, MoreHorizontal, Pencil, Plus, ShieldAlert, UserCheck, UserX, Users } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states"
import { newPasswordProblem } from "@/components/shell/change-password-dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, errorMessage } from "@/lib/api/client"
import type { Account, Role } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { formatDateTime, formatRelative } from "@/lib/values"

const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "viewer", label: "Viewer", description: "Can view all plants, history and legacy data. Cannot change anything." },
  { value: "editor", label: "Editor", description: "Can also edit plant data: equipment, parameters, modules, filters." },
  { value: "admin", label: "Admin", description: "Can also create and delete plants, and manage users and roles." },
]
const USERNAME = /^[A-Za-z0-9._@-]{3,64}$/

function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: () => api<{ items: Account[] }>("users") })
}

function useUserWrite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: { path: string; method: "POST" | "PATCH"; body: unknown; success: string }) =>
      api<Account>(req.path, { method: req.method, body: req.body }),
    onSuccess: (_d, req) => toast.success(req.success),
    onSettled: () => qc.invalidateQueries({ queryKey: ["users"] }),
  })
}

function RoleSelect({ value, onChange, id }: { value: Role; onChange: (r: Role) => void; id: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Role</Label>
      <Select value={value} onValueChange={(v) => onChange(v as Role)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">{ROLES.find((r) => r.value === value)?.description}</p>
    </div>
  )
}

function FormDialog({
  title,
  description,
  busy,
  error,
  canSubmit,
  submitLabel,
  onSubmit,
  onClose,
  children,
}: {
  title: string
  description?: string
  busy: boolean
  error: string | null
  canSubmit: boolean
  submitLabel: string
  onSubmit: () => void
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) onSubmit()
          }}
        >
          {children}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !canSubmit}>
              {busy && <Loader2 className="animate-spin" />} {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const write = useUserWrite()
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [role, setRole] = useState<Role>("viewer")
  const [pw, setPw] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const userProblem = username && !USERNAME.test(username) ? "3–64 characters: letters, digits, . _ @ -" : null
  const nameProblem = displayName !== displayName.trim() ? "Remove spaces at the start or end" : null
  const pwProblem = newPasswordProblem(pw, confirm, username)
  const canSubmit = !!username && !!pw && !!confirm && !userProblem && !nameProblem && !pwProblem

  return (
    <FormDialog
      title="New user"
      description="The user signs in with this username and password. Ask them to change the password after their first sign-in."
      busy={write.isPending}
      error={error}
      canSubmit={canSubmit}
      submitLabel="Create user"
      onClose={onClose}
      onSubmit={() =>
        write
          .mutateAsync({
            path: "users",
            method: "POST",
            body: { username, display_name: displayName || null, role, password: pw },
            success: `User ${username} created`,
          })
          .then(onClose, (e) => setError(errorMessage(e)))
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="u-username">Username</Label>
        <Input id="u-username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        {userProblem && <span className="text-xs text-destructive">{userProblem}</span>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="u-name">Full name (optional)</Label>
        <Input id="u-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        {nameProblem && <span className="text-xs text-destructive">{nameProblem}</span>}
      </div>
      <RoleSelect id="u-role" value={role} onChange={setRole} />
      <div className="grid gap-1.5">
        <Label htmlFor="u-pw">Password</Label>
        <Input id="u-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="u-pw2">Repeat password</Label>
        <Input id="u-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {pwProblem && <span className="text-xs text-destructive">{pwProblem}</span>}
      </div>
    </FormDialog>
  )
}

function EditUserDialog({ account, isSelf, onClose }: { account: Account; isSelf: boolean; onClose: () => void }) {
  const write = useUserWrite()
  const [displayName, setDisplayName] = useState(account.display_name ?? "")
  const [role, setRole] = useState<Role>(account.role)
  const [error, setError] = useState<string | null>(null)
  const nameProblem = displayName !== displayName.trim() ? "Remove spaces at the start or end" : null
  const body: Record<string, unknown> = {}
  if ((displayName || null) !== account.display_name) body.display_name = displayName || null
  if (role !== account.role) body.role = role

  return (
    <FormDialog
      title={`Edit ${account.username}`}
      busy={write.isPending}
      error={error}
      canSubmit={Object.keys(body).length > 0 && !nameProblem}
      submitLabel="Save"
      onClose={onClose}
      onSubmit={() =>
        write
          .mutateAsync({
            path: `users/${account.id}`,
            method: "PATCH",
            body: { ...body, expected_updated_at: account.updated_at },
            success: `${account.username} updated`,
          })
          .then(onClose, (e) => setError(errorMessage(e)))
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="e-name">Full name</Label>
        <Input id="e-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        {nameProblem && <span className="text-xs text-destructive">{nameProblem}</span>}
      </div>
      {isSelf ? (
        <p className="text-sm text-muted-foreground">You cannot change your own role. Ask another admin.</p>
      ) : (
        <RoleSelect id="e-role" value={role} onChange={setRole} />
      )}
    </FormDialog>
  )
}

function ResetPasswordDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const write = useUserWrite()
  const [pw, setPw] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const problem = newPasswordProblem(pw, confirm, account.username)
  return (
    <FormDialog
      title={`Reset password for ${account.username}`}
      description="The account is unlocked and signed out on all devices. Give the new password to the user securely."
      busy={write.isPending}
      error={error}
      canSubmit={!!pw && !!confirm && !problem}
      submitLabel="Reset password"
      onClose={onClose}
      onSubmit={() =>
        write
          .mutateAsync({ path: `users/${account.id}/password`, method: "POST", body: { new_password: pw }, success: `Password reset for ${account.username}` })
          .then(onClose, (e) => setError(errorMessage(e)))
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="r-pw">New password</Label>
        <Input id="r-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="r-pw2">Repeat new password</Label>
        <Input id="r-pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {problem && <span className="text-xs text-destructive">{problem}</span>}
      </div>
    </FormDialog>
  )
}

function ToggleActiveDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const write = useUserWrite()
  const deactivate = account.is_active
  return (
    <AlertDialog open onOpenChange={(o) => !o && !write.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{deactivate ? `Deactivate ${account.username}?` : `Reactivate ${account.username}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {deactivate
              ? "They are signed out immediately and can no longer sign in. Their past changes stay in the history. You can reactivate the account later."
              : "They will be able to sign in again with their current password."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={write.isPending}>Cancel</AlertDialogCancel>
          <Button
            variant={deactivate ? "destructive" : "default"}
            disabled={write.isPending}
            onClick={() =>
              write
                .mutateAsync({
                  path: `users/${account.id}`,
                  method: "PATCH",
                  body: { is_active: !deactivate },
                  success: deactivate ? `${account.username} deactivated` : `${account.username} reactivated`,
                })
                .then(onClose, (e) => toast.error(errorMessage(e)))
            }
          >
            {write.isPending && <Loader2 className="animate-spin" />} {deactivate ? "Deactivate" : "Reactivate"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

type Dialogs = { kind: "create" } | { kind: "edit" | "reset" | "active"; account: Account } | null

export function UserAdmin() {
  const { user, can } = useSession()
  const { data, isLoading, isError, error, refetch } = useUsers()
  const write = useUserWrite()
  const [dialog, setDialog] = useState<Dialogs>(null)

  if (!can("admin"))
    return <EmptyState icon={ShieldAlert} title="Admins only" message="You need the admin role to manage users." />

  const active = data?.items.filter((u) => u.is_active).length ?? 0

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <PageHeader title="Users" description={data ? `${active} active user${active === 1 ? "" : "s"} · roles control what each person can do` : undefined}>
        <Button onClick={() => setDialog({ kind: "create" })}>
          <Plus /> New user
        </Button>
      </PageHeader>

      <div className="grid gap-2 text-sm sm:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r.value} className="rounded-lg border bg-card p-3">
            <div className="font-medium">{r.label}</div>
            <p className="text-xs text-muted-foreground">{r.description}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {isLoading ? (
          <TableSkeleton rows={4} cols={4} />
        ) : isError ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : data?.items.length === 0 ? (
          <EmptyState icon={Users} title="No users yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="w-10" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.map((u) => {
                const isSelf = u.username === user.username
                return (
                  <TableRow key={u.id} data-username={u.username} className={u.is_active ? undefined : "text-muted-foreground"}>
                    <TableCell>
                      <div className="font-medium">
                        {u.display_name ?? u.username}
                        {isSelf && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                      </div>
                      {u.display_name && <div className="text-xs text-muted-foreground">@{u.username}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="capitalize">
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {!u.is_active ? (
                        <Badge variant="outline">Deactivated</Badge>
                      ) : u.locked ? (
                        <Badge variant="destructive">Locked</Badge>
                      ) : (
                        <Badge variant="outline" className="border-added/40 text-added-foreground">
                          Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm" title={u.last_login_at ? formatDateTime(u.last_login_at) : undefined}>
                      {u.last_login_at ? formatRelative(u.last_login_at) : <span className="text-muted-foreground">Never</span>}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${u.username}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setDialog({ kind: "edit", account: u })}>
                            <Pencil /> Edit name / role…
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDialog({ kind: "reset", account: u })}>
                            <KeyRound /> Reset password…
                          </DropdownMenuItem>
                          {u.locked && (
                            <DropdownMenuItem
                              onSelect={() =>
                                write.mutateAsync({ path: `users/${u.id}`, method: "PATCH", body: { unlock: true }, success: `${u.username} unlocked` }).catch((e) => toast.error(errorMessage(e)))
                              }
                            >
                              <LockOpen /> Unlock
                            </DropdownMenuItem>
                          )}
                          {!isSelf && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant={u.is_active ? "destructive" : "default"} onSelect={() => setDialog({ kind: "active", account: u })}>
                                {u.is_active ? <UserX /> : <UserCheck />} {u.is_active ? "Deactivate…" : "Reactivate…"}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Accounts are never deleted, so every change in the history stays attributed. Five wrong passwords lock an account for 15 minutes.
      </p>

      {dialog?.kind === "create" && <CreateUserDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <EditUserDialog account={dialog.account} isSelf={dialog.account.username === user.username} onClose={() => setDialog(null)} />}
      {dialog?.kind === "reset" && <ResetPasswordDialog account={dialog.account} onClose={() => setDialog(null)} />}
      {dialog?.kind === "active" && <ToggleActiveDialog account={dialog.account} onClose={() => setDialog(null)} />}
    </div>
  )
}
