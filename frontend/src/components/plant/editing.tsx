"use client"

import { Check, GripVertical, Loader2, X } from "lucide-react"
import { useState } from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { reasonProblem } from "@/lib/api/client"
import type { Text } from "@/lib/api/types"
import { cn } from "@/lib/utils"

// ------------------------------------------------------------------ validation
/**
 * Mirrors the API's text rules (api/pdm_api/models.py). Input is never trimmed
 * or rewritten; a problem is reported instead. An empty box means "no value" (null).
 */
export function textProblem(v: string): string | null {
  if (v === "") return null
  if (v !== v.trim()) return "Remove spaces at the start or end"
  if (/[\x00-\x08\x0a-\x1f\x7f]/.test(v)) return "Line breaks and control characters are not allowed"
  if (v.length > 1000) return "At most 1000 characters"
  return null
}

export const toValue = (v: string): Text => (v === "" ? null : v)
export const toInput = (v: Text | number | undefined): string => (v === null || v === undefined ? "" : String(v))

// ------------------------------------------------------------------ inline editor
export function InlineEditor({
  initial,
  label,
  mono,
  onSave,
  onCancel,
}: {
  initial: Text
  label: string
  mono?: boolean
  onSave: (v: Text) => Promise<unknown>
  onCancel: () => void
}) {
  const [v, setV] = useState(toInput(initial))
  const [busy, setBusy] = useState(false)
  const problem = textProblem(v)

  async function save() {
    if (problem) return
    if (toValue(v) === initial) return onCancel()
    setBusy(true)
    try {
      await onSave(toValue(v))
      onCancel()
    } catch {
      /* toast already shown; keep editor open */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-32 flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          aria-label={label}
          value={v}
          disabled={busy}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void save()
            }
            if (e.key === "Escape") onCancel()
          }}
          placeholder="(no value)"
          className={cn("h-7 px-1.5 text-sm", mono && "font-mono text-xs")}
          aria-invalid={problem ? true : undefined}
        />
        <Button size="icon-xs" onClick={save} disabled={busy || !!problem} aria-label="Save">
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
        <Button size="icon-xs" variant="ghost" onClick={onCancel} disabled={busy} aria-label="Cancel">
          <X />
        </Button>
      </div>
      {problem && <span className="text-xs text-destructive">{problem}</span>}
    </div>
  )
}

// ------------------------------------------------------------------ reason
export function ReasonInput({
  value,
  onChange,
  id = "reason",
  compact,
}: {
  value: string
  onChange: (v: string) => void
  id?: string
  compact?: boolean
}) {
  const problem = reasonProblem(value)
  return (
    <div className="grid gap-1.5">
      {!compact && (
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          Reason for change (optional, saved in history)
        </Label>
      )}
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={compact ? "Change note (optional) — saved with each edit" : "e.g. Verified against nameplate"}
        className={cn(compact && "h-7 text-xs")}
        aria-invalid={problem ? true : undefined}
        aria-label="Reason for change"
      />
      {problem && <span className="text-xs text-destructive">{problem}</span>}
    </div>
  )
}

// ------------------------------------------------------------------ confirm delete
export function ConfirmDelete({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  initialReason = "",
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: React.ReactNode
  onConfirm: (reason: string) => Promise<unknown>
  initialReason?: string
}) {
  const [reason, setReason] = useState(initialReason)
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ReasonInput id="delete-reason" value={reason} onChange={setReason} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy || !!reasonProblem(reason)}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm(reason)
                onOpenChange(false)
              } catch {
                /* toast shown */
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ------------------------------------------------------------------ row form (drawer)
export interface FormField {
  key: string
  label: string
  mono?: boolean
  hint?: React.ReactNode
  /** Original legacy value, shown under the input when editing a legacy row. */
  original?: Text
  hasOriginal?: boolean
}

export function RowFormSheet({
  open,
  onOpenChange,
  title,
  description,
  fields,
  initial,
  positions,
  initialReason = "",
  submitLabel = "Save",
  requireAny,
  onSubmit,
  children,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description?: React.ReactNode
  fields: FormField[]
  initial: Record<string, Text>
  /** When set, shows a position picker: number of existing rows. */
  positions?: { count: number; labelOf: (pos: number) => string }
  initialReason?: string
  submitLabel?: string
  /** Require at least one non-empty field (new rows). */
  requireAny?: boolean
  onSubmit: (values: Record<string, Text>, reason: string, position: number | null) => Promise<unknown>
  children?: React.ReactNode
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, toInput(initial[f.key])])),
  )
  const [position, setPosition] = useState<string>("end")
  const [reason, setReason] = useState(initialReason)
  const [busy, setBusy] = useState(false)
  const problems = Object.fromEntries(fields.map((f) => [f.key, textProblem(values[f.key] ?? "")]))
  const allEmpty = fields.every((f) => (values[f.key] ?? "") === "")
  const invalid = Object.values(problems).some(Boolean) || !!reasonProblem(reason) || (!!requireAny && allEmpty)
  const changed = fields.some((f) => toValue(values[f.key] ?? "") !== (initial[f.key] ?? null))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (invalid) return
    setBusy(true)
    try {
      const out = Object.fromEntries(fields.map((f) => [f.key, toValue(values[f.key] ?? "")]))
      await onSubmit(out, reason, position === "end" ? null : Number(position))
      onOpenChange(false)
    } catch {
      /* toast shown */
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {fields.map((f) => (
              <div key={f.key} className="grid gap-1.5">
                <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
                <Input
                  id={`f-${f.key}`}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                  placeholder="(no value)"
                  className={cn(f.mono && "font-mono")}
                  aria-invalid={problems[f.key] ? true : undefined}
                />
                {problems[f.key] && <span className="text-xs text-destructive">{problems[f.key]}</span>}
                {f.hasOriginal && (
                  <span className="text-xs text-muted-foreground">
                    Legacy value:{" "}
                    <span className="font-medium text-foreground/80">{f.original ?? "(no value)"}</span>
                  </span>
                )}
                {f.hint && <span className="text-xs text-muted-foreground">{f.hint}</span>}
              </div>
            ))}
            {positions && (
              <div className="grid gap-1.5">
                <Label>Position</Label>
                <Select value={position} onValueChange={setPosition}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="end">At the end</SelectItem>
                    {Array.from({ length: positions.count }, (_, i) => i + 1).map((p) => (
                      <SelectItem key={p} value={String(p)}>
                        Before #{p} — {positions.labelOf(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {children}
            {requireAny && allEmpty && <p className="text-xs text-muted-foreground">Fill in at least one field.</p>}
            <p className="text-xs text-muted-foreground">
              Leave a box empty for “no value”. Text such as N/A or NA is saved exactly as typed.
            </p>
            <ReasonInput id="form-reason" value={reason} onChange={setReason} />
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || invalid || (!changed && !positions)}>
              {busy && <Loader2 className="animate-spin" />} {submitLabel}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// ------------------------------------------------------------------ drag and drop
export function DragHandle(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
      aria-label="Drag to reorder"
      {...props}
    >
      <GripVertical className="size-4" />
    </button>
  )
}

export function moveId(ids: number[], id: number, delta: number): number[] {
  const i = ids.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= ids.length) return ids
  const next = [...ids]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}
