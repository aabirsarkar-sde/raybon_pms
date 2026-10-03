"use client"

import {
  Download,
  Eye,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  X,
} from "lucide-react"
import { useState } from "react"

import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states"
import { ConfirmDelete, ReasonInput } from "@/components/plant/editing"
import { usePlantCtx } from "@/components/plant/plant-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { Textarea } from "@/components/ui/textarea"
import { apiUrl, reasonProblem } from "@/lib/api/client"
import { useDocumentCategories, usePlantDocumentWrite, usePlantDocuments } from "@/lib/api/hooks"
import type { PlantDocument } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { formatBytes } from "@/lib/equipment"
import { cn } from "@/lib/utils"

import { UploadDocumentDialog, type UploadPayload } from "./upload-dialog"

const IMAGE = /^image\//
const SHEET = /sheet|excel|csv/

function FileIcon({ doc }: { doc: PlantDocument }) {
  const Icon = IMAGE.test(doc.content_type) ? ImageIcon : SHEET.test(doc.content_type) ? Table2 : FileText
  return <Icon className="size-4 shrink-0 text-muted-foreground" />
}

function when(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/** Rename a document, move it to another category or change its notes. The file itself is untouched. */
function EditDocumentDialog({
  doc,
  categories,
  onSave,
  open,
  onOpenChange,
}: {
  doc: PlantDocument
  categories: { key: string; label: string }[]
  onSave: (changes: { category: string; title: string; description: string | null }, reason: string | null) => Promise<unknown>
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const [category, setCategory] = useState(doc.category as string)
  const [title, setTitle] = useState(doc.title)
  const [description, setDescription] = useState(doc.description ?? "")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const ready = title.trim().length > 0 && !reasonProblem(reason)

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit document details</DialogTitle>
          <DialogDescription>
            Changes how <strong>{doc.file_name}</strong> is filed and described. To change the file itself,
            upload a new revision.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="edit-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-description" className="text-xs text-muted-foreground">
              Notes (optional)
            </Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={2000}
            />
          </div>
          <ReasonInput id="edit-reason" value={reason} onChange={setReason} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onSave(
                  { category, title: title.trim(), description: description.trim() || null },
                  reason.trim() || null,
                )
                onOpenChange(false)
              } catch {
                /* a toast has already been shown */
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DocumentRow({
  doc,
  canEdit,
  onReplace,
  onEdit,
  onDelete,
}: {
  doc: PlantDocument
  canEdit: boolean
  onReplace: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  // The proxy path carries the session cookie, so a plain link downloads the file.
  const download = apiUrl(`plants/${doc.plant_id}/documents/${doc.id}/content`)
  const preview = apiUrl(`plants/${doc.plant_id}/documents/${doc.id}/content`, { inline: "true" })

  return (
    <li className="flex min-w-0 items-start gap-3 px-3 py-2.5">
      <FileIcon doc={doc} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <a href={download} className="font-medium hover:underline" download>
            {doc.title}
          </a>
          <Badge variant="secondary">{doc.category_label}</Badge>
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="max-w-full truncate font-mono" title={doc.file_name}>
            {doc.file_name}
          </span>
          <span className="tabular">{formatBytes(doc.byte_size)}</span>
          <span>
            {when(doc.created_at)}
            {doc.uploaded_by && ` · ${doc.uploaded_by}`}
          </span>
          {doc.updated_at !== doc.created_at && <span>revised {when(doc.updated_at)}</span>}
        </div>
        {doc.description && <p className="mt-1 text-sm text-foreground/80">{doc.description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {doc.can_preview && (
          <Button asChild variant="ghost" size="icon-sm" aria-label={`Open ${doc.title} in a new tab`}>
            <a href={preview} target="_blank" rel="noopener noreferrer">
              <Eye />
            </a>
          </Button>
        )}
        <Button asChild variant="ghost" size="icon-sm" aria-label={`Download ${doc.title}`}>
          <a href={download} download>
            <Download />
          </a>
        </Button>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${doc.title}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onReplace}>
                <RefreshCw /> Upload new revision
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </li>
  )
}

/**
 * A plant's document library: P&IDs, electrical drawings, manuals, layouts and
 * anything else that belongs to the site, kept with the plant rather than in
 * someone's folder.
 *
 * Uploads, revisions, re-filing and deletions all go through the audited API, so
 * the plant's History tab shows who changed the library and why.
 */
export function PlantDocuments() {
  const { plant } = usePlantCtx()
  const { can } = useSession()
  const canEdit = can("edit")

  const [category, setCategory] = useState<string>("all")
  const [text, setText] = useState("")
  const info = useDocumentCategories()
  const { data, isLoading, isError, error, refetch, isFetching } = usePlantDocuments(plant.id, {
    category: category === "all" ? undefined : category,
    q: text.trim() || undefined,
  })
  const { upload, write } = usePlantDocumentWrite(plant.id)

  const [adding, setAdding] = useState(false)
  const [replacing, setReplacing] = useState<PlantDocument | null>(null)
  const [editing, setEditing] = useState<PlantDocument | null>(null)
  const [deleting, setDeleting] = useState<PlantDocument | null>(null)

  const categories = info.data?.items ?? []
  const counts = data?.counts ?? {}
  const filtered = category !== "all" || text.trim().length > 0
  const doUpload = (p: UploadPayload) => upload.mutateAsync(p)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search title, notes or file name…"
            className="pr-8 pl-8"
            aria-label="Search documents"
          />
          {isFetching && !isLoading ? (
            <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : text ? (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setText("")}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-48" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories ({data?.total ?? 0})</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.key} value={c.key} disabled={!counts[c.key] && category !== c.key}>
                {c.label} ({counts[c.key] ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canEdit && (
          <UploadDocumentDialog
            info={info.data}
            existing={data?.items ?? []}
            defaultCategory={category === "all" ? undefined : (category as PlantDocument["category"])}
            onUpload={doUpload}
            open={adding}
            onOpenChange={setAdding}
            trigger={
              <Button>
                <Plus /> Add document
              </Button>
            }
          />
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-3 py-2">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <FolderOpen className="size-4 text-muted-foreground" /> Document library
            <Badge variant="secondary" className="tabular">
              {data?.total ?? 0}
            </Badge>
          </h2>
          {data && data.total_bytes > 0 && (
            <p className="text-xs text-muted-foreground tabular">{formatBytes(data.total_bytes)} in total</p>
          )}
        </header>

        {isLoading ? (
          <TableSkeleton rows={4} cols={3} />
        ) : isError ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={filtered ? "No documents match" : "No documents yet"}
            message={
              filtered
                ? "Try a different search, or choose another category."
                : canEdit
                  ? "Upload this plant's P&IDs, electrical drawings, manuals and layouts so they stay with the plant."
                  : "Nothing has been uploaded for this plant yet. Ask an editor to add its drawings and manuals."
            }
            action={
              filtered ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setText("")
                    setCategory("all")
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                canEdit && (
                  <Button onClick={() => setAdding(true)}>
                    <Plus /> Add the first document
                  </Button>
                )
              )
            }
          />
        ) : (
          <ul className={cn("divide-y", isFetching && "opacity-70 transition-opacity")}>
            {data.items.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                canEdit={canEdit}
                onReplace={() => setReplacing(doc)}
                onEdit={() => setEditing(doc)}
                onDelete={() => setDeleting(doc)}
              />
            ))}
          </ul>
        )}
      </div>

      {replacing && (
        <UploadDocumentDialog
          info={info.data}
          existing={data?.items ?? []}
          replacing={replacing}
          onUpload={doUpload}
          open
          onOpenChange={(o) => !o && setReplacing(null)}
        />
      )}

      {editing && (
        <EditDocumentDialog
          doc={editing}
          categories={categories}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          onSave={(changes, reason) =>
            write.mutateAsync({
              path: `plants/${plant.id}/documents/${editing.id}`,
              method: "PATCH",
              body: { ...changes, expected_updated_at: editing.updated_at },
              reason,
              success: "Document updated",
            })
          }
        />
      )}

      {deleting && (
        <ConfirmDelete
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title="Delete this document?"
          description={
            <p>
              <strong>{deleting.title}</strong> ({deleting.file_name}) will be removed from this plant&rsquo;s
              library, and the file itself will be deleted. The deletion is recorded in the audit log.
            </p>
          }
          onConfirm={async (reason) => {
            await write.mutateAsync({
              path: `plants/${plant.id}/documents/${deleting.id}`,
              method: "DELETE",
              reason,
              success: "Document deleted",
            })
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}
