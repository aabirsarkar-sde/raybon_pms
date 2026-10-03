"use client"

import { FileUp, Loader2, Paperclip, Upload, X } from "lucide-react"
import { useRef, useState } from "react"

import { ReasonInput } from "@/components/plant/editing"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { reasonProblem } from "@/lib/api/client"
import type { DocumentCategory, DocumentCategoryInfo, PlantDocument } from "@/lib/api/types"
import { formatBytes } from "@/lib/equipment"
import { cn } from "@/lib/utils"

export interface UploadPayload {
  file: File
  category: string
  title: string
  description: string | null
  replace: boolean
  reason: string | null
}

/**
 * Add a document to a plant's library, or replace one with a newer revision.
 *
 * The file type and size limits are the API's own (GET /document-categories), so
 * the form rejects what the server would reject, with the same wording.
 */
export function UploadDocumentDialog({
  info,
  existing,
  defaultCategory,
  onUpload,
  replacing,
  trigger,
  open,
  onOpenChange,
}: {
  info: DocumentCategoryInfo | undefined
  /** The plant's current documents, to warn before overwriting one. */
  existing: PlantDocument[]
  defaultCategory?: DocumentCategory
  onUpload: (payload: UploadPayload) => Promise<unknown>
  /** Set when replacing a specific document: its category and file name are fixed. */
  replacing?: PlantDocument
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (o: boolean) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState<string>(replacing?.category ?? defaultCategory ?? "pid")
  const [title, setTitle] = useState(replacing?.title ?? "")
  const [description, setDescription] = useState(replacing?.description ?? "")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const maxBytes = info?.max_bytes ?? 25 * 1024 * 1024
  const allowed = info?.allowed_extensions ?? []
  const accept = allowed.map((e) => `.${e}`).join(",")
  const extension = file?.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : ""

  const problem = (() => {
    if (!file) return null
    if (!extension) return "The file needs an extension so its type can be recognised."
    if (allowed.length && !allowed.includes(extension))
      return `“.${extension}” files are not accepted. Allowed: ${allowed.map((e) => `.${e}`).join(", ")}`
    if (file.size === 0) return "The file is empty."
    if (file.size > maxBytes) return `The file is ${formatBytes(file.size)} — the limit is ${formatBytes(maxBytes)}.`
    return null
  })()

  // Same (plant, category, file name) as a document already there: that is a revision.
  const clash = file
    ? existing.find(
        (d) =>
          d.id !== replacing?.id &&
          d.category === category &&
          d.file_name.toLowerCase() === file.name.toLowerCase(),
      )
    : undefined
  const replacingDoc = replacing ?? clash
  const ready = file && !problem && title.trim().length > 0 && !reasonProblem(reason)

  function reset() {
    setFile(null)
    setCategory(replacing?.category ?? defaultCategory ?? "pid")
    setTitle(replacing?.title ?? "")
    setDescription(replacing?.description ?? "")
    setReason("")
    setDragging(false)
  }

  function pick(next: File | null) {
    setFile(next)
    // Offer the file's own name as the title, so the common case needs no typing.
    if (next && !title.trim()) setTitle(next.name.replace(/\.[^.]+$/, ""))
  }

  async function submit() {
    if (!file || !ready) return
    setBusy(true)
    try {
      await onUpload({
        file,
        category,
        title: title.trim(),
        description: description.trim() || null,
        replace: Boolean(replacingDoc),
        reason: reason.trim() || null,
      })
      reset()
      onOpenChange?.(false)
    } catch {
      /* a toast has already been shown */
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        if (!o) reset()
        onOpenChange?.(o)
      }}
    >
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{replacing ? "Upload a new revision" : "Add a document"}</DialogTitle>
          <DialogDescription>
            {replacing ? (
              <>
                Replaces the file in <strong>{replacing.title}</strong>. The document keeps its place in the
                library, and the change is recorded in the plant&rsquo;s history.
              </>
            ) : (
              <>
                P&amp;IDs, electrical drawings, manuals, layouts and anything else that belongs to this plant.
                Up to {formatBytes(maxBytes)} per file.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {/* ---- file */}
          <div className="grid gap-1.5">
            <Label htmlFor="document-file">File</Label>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                pick(e.dataTransfer.files?.[0] ?? null)
              }}
              className={cn(
                "rounded-md border border-dashed px-3 py-4 text-center",
                dragging ? "border-primary bg-primary/5" : "border-input",
              )}
            >
              <input
                ref={inputRef}
                id="document-file"
                type="file"
                accept={accept || undefined}
                className="sr-only"
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <div className="flex items-center gap-2 text-left">
                  <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{file.name}</span>
                    <span className="text-xs text-muted-foreground tabular">{formatBytes(file.size)}</span>
                  </span>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove file" onClick={() => setFile(null)}>
                    <X />
                  </Button>
                </div>
              ) : (
                <>
                  <FileUp className="mx-auto size-6 text-muted-foreground" />
                  <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => inputRef.current?.click()}>
                    Choose a file
                  </Button>
                  <p className="mt-1.5 text-xs text-muted-foreground">or drag it here</p>
                </>
              )}
            </div>
            {problem && <p className="text-xs text-destructive">{problem}</p>}
            {!problem && replacingDoc && (
              <p className="text-xs text-amber-700 dark:text-amber-500">
                {replacing
                  ? "The current file will be replaced."
                  : `“${replacingDoc.file_name}” is already filed under ${replacingDoc.category_label}. Uploading replaces it with this revision.`}
              </p>
            )}
          </div>

          {/* ---- filing */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="document-category">Category</Label>
              <Select value={category} onValueChange={setCategory} disabled={Boolean(replacing)}>
                <SelectTrigger id="document-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(info?.items ?? []).map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="document-title">Title</Label>
              <Input
                id="document-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. RO skid P&ID — Rev A"
                maxLength={300}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="document-description" className="text-xs text-muted-foreground">
              Notes (optional)
            </Label>
            <Textarea
              id="document-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Revision, drawing number, who issued it…"
              rows={2}
              maxLength={2000}
            />
          </div>

          <ReasonInput id="document-reason" value={reason} onChange={setReason} />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={!ready || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />}
            {replacingDoc ? "Upload revision" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
