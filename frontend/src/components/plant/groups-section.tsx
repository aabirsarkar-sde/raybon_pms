"use client"

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Loader2, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react"
import { useState } from "react"

import { DiffValue, OriginBadge } from "@/components/common/value"
import { Button } from "@/components/ui/button"
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
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { reasonProblem } from "@/lib/api/client"
import type { ChildRow, FilterRow, HpGroupRow, Section, Text } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import type { SectionDef } from "@/lib/sections"
import { cn } from "@/lib/utils"

import { ConfirmDelete, InlineEditor, moveId, ReasonInput, RowFormSheet, textProblem, toValue } from "./editing"
import { usePlantCtx } from "./plant-context"
import { SectionCard, SectionEmpty } from "./section-card"

type Group = FilterRow | HpGroupRow

function groupName(def: SectionDef, g: Group): Text {
  return (g.current as Record<string, Text>)[def.labelField] ?? null
}
function childrenOf(def: SectionDef, g: Group): ChildRow[] {
  return (g as unknown as Record<string, ChildRow[]>)[def.child!.key] ?? []
}

// ------------------------------------------------------------------ add group sheet
function AddGroupSheet({
  def,
  groups,
  note,
  onClose,
}: {
  def: SectionDef
  groups: Group[]
  note: string
  onClose: () => void
}) {
  const { plant, write } = usePlantCtx()
  const child = def.child!
  const [name, setName] = useState("")
  const [entries, setEntries] = useState<{ label: string; value: string }[]>([{ label: "", value: "" }])
  const [position, setPosition] = useState("end")
  const [reason, setReason] = useState(note)
  const [busy, setBusy] = useState(false)
  const problems = [textProblem(name), ...entries.flatMap((e) => [textProblem(e.label), textProblem(e.value)])]
  const filled = entries.filter((e) => e.label !== "" || e.value !== "")
  const invalid = problems.some(Boolean) || !!reasonProblem(reason) || (name === "" && filled.length === 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await write({
        path: `plants/${plant.id}/${def.slug}`,
        method: "POST",
        body: {
          [def.labelField]: toValue(name),
          position: position === "end" ? null : Number(position),
          [child.key]: filled.map((x) => ({ label: toValue(x.label), value: toValue(x.value) })),
        },
        reason,
        success: `${def.title}: ${def.noun} added`,
      })
      onClose()
    } catch {
      /* toast shown */
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && !busy && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>Add {def.noun}</SheetTitle>
          <SheetDescription>{def.title}</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="g-name">{def.columns[0].label} name</Label>
              <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="(no value)" />
              {textProblem(name) && <span className="text-xs text-destructive">{textProblem(name)}</span>}
            </div>
            <div className="grid gap-2">
              <Label>{child.noun === "value" ? "Values" : "Entries"} (in order)</Label>
              {def.key === "filters" && (
                <p className="text-xs text-muted-foreground">
                  Legacy filter values have no labels. Leave the label empty unless the meaning is known.
                </p>
              )}
              {entries.map((x, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="mt-2 w-5 text-right text-xs text-muted-foreground tabular">{i + 1}</span>
                  <Input
                    aria-label={`Label ${i + 1}`}
                    value={x.label}
                    placeholder="Label (optional)"
                    onChange={(e) => setEntries((s) => s.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))}
                  />
                  <Input
                    aria-label={`Value ${i + 1}`}
                    value={x.value}
                    placeholder="Value"
                    onChange={(e) => setEntries((s) => s.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove row ${i + 1}`}
                    onClick={() => setEntries((s) => s.filter((_, j) => j !== i))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => setEntries((s) => [...s, { label: "", value: "" }])}>
                <Plus /> Add {child.noun}
              </Button>
            </div>
            <div className="grid gap-1.5">
              <Label>Position</Label>
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="end">At the end</SelectItem>
                  {groups.map((g, i) => (
                    <SelectItem key={g.id} value={String(i + 1)}>
                      Before #{i + 1} — {groupName(def, g) ?? "(unnamed)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {problems.some(Boolean) && <p className="text-xs text-destructive">Remove spaces at the start/end of values.</p>}
            <ReasonInput id="group-reason" value={reason} onChange={setReason} />
          </div>
          <SheetFooter className="flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || invalid}>
              {busy && <Loader2 className="animate-spin" />} Add {def.noun}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// ------------------------------------------------------------------ one group panel
function GroupPanel({
  def,
  group,
  index,
  total,
  editMode,
  note,
  onMove,
  onDelete,
}: {
  def: SectionDef
  group: Group
  index: number
  total: number
  editMode: boolean
  note: string
  onMove: (delta: number) => void
  onDelete: () => void
}) {
  const { plant, write } = usePlantCtx()
  const child = def.child!
  const base = `plants/${plant.id}/${def.slug}/${group.id}`
  const [cell, setCell] = useState<{ id: number; key: "label" | "value" } | "name" | null>(null)
  const [addEntry, setAddEntry] = useState(false)
  const [delEntry, setDelEntry] = useState<ChildRow | null>(null)
  const entries = childrenOf(def, group)
  const name = groupName(def, group)
  const modified = group.modified_fields.length > 0

  const patchEntry = (e: ChildRow, key: string) => (value: Text) =>
    write({ path: `${base}/${child.slug}/${e.id}`, method: "PATCH", body: { [key]: value, expected_updated_at: e.updated_at }, reason: note, success: "Saved" })

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-md border bg-background",
        group.origin === "app" && "border-added/50 bg-added-subtle/40",
        modified && "border-modified/60",
      )}
      data-group-id={group.id}
    >
      <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5">
        <span className="text-[10px] text-muted-foreground tabular">{index + 1}</span>
        <div className="min-w-0 flex-1 text-sm font-medium">
          {cell === "name" ? (
            <InlineEditor
              initial={name}
              label={`${def.noun} name`}
              onCancel={() => setCell(null)}
              onSave={(v) =>
                write({ path: base, method: "PATCH", body: { [def.labelField]: v, expected_updated_at: group.updated_at }, reason: note, success: "Saved" })
              }
            />
          ) : (
            <span
              className={cn(editMode && "cursor-text rounded hover:bg-accent/60")}
              onClick={editMode ? () => setCell("name") : undefined}
            >
              <DiffValue current={name} original={group.original?.[def.labelField] as Text} hasOriginal={group.original !== null} />
            </span>
          )}
        </div>
        <OriginBadge origin={group.origin} modified={modified} />
        {editMode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${name ?? def.noun}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setCell("name")}>
                <Pencil /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAddEntry(true)}>
                <Plus /> Add {child.noun}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
                <ArrowLeft /> Move earlier
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === total - 1} onSelect={() => onMove(1)}>
                <ArrowRight /> Move later
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 /> Delete {def.noun}…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <ul className="flex-1 divide-y text-[13px]">
        {entries.length === 0 && <li className="px-2.5 py-2 text-xs text-muted-foreground">No {child.noun}s</li>}
        {entries.map((e, i) => {
          const eModified = e.modified_fields.length > 0
          return (
            <li
              key={e.id}
              className={cn(
                "flex items-start gap-2 px-2.5 py-1.5",
                e.origin === "app" && "bg-added-subtle/60",
                eModified && "shadow-[inset_2px_0_0_var(--modified)]",
              )}
              data-entry-id={e.id}
            >
              <span className="mt-0.5 w-4 shrink-0 text-right text-[10px] text-muted-foreground tabular">#{i + 1}</span>
              <div className="grid min-w-0 flex-1 gap-0.5">
                {(["label", "value"] as const).map((k) => {
                  const editingThis = typeof cell === "object" && cell?.id === e.id && cell.key === k
                  const v = e.current[k]
                  if (editingThis)
                    return <InlineEditor key={k} initial={v} label={`${k} ${i + 1}`} onSave={patchEntry(e, k)} onCancel={() => setCell(null)} />
                  const showEmptyLabel = k === "label" && v === null && !(e.original && e.original.label !== null)
                  return (
                    <span
                      key={k}
                      className={cn(
                        k === "label" ? "text-xs text-muted-foreground" : "break-words",
                        editMode && "cursor-text rounded hover:bg-accent/60",
                      )}
                      onClick={editMode ? () => setCell({ id: e.id, key: k }) : undefined}
                      title={editMode ? `Click to edit ${k}` : undefined}
                    >
                      {showEmptyLabel ? (
                        editMode ? (
                          <span className="italic opacity-60">(unlabelled — click to add label)</span>
                        ) : def.key === "filters" ? (
                          <span className="italic opacity-60">(unlabelled)</span>
                        ) : null
                      ) : (
                        <DiffValue current={v} original={e.original?.[k] as Text} hasOriginal={e.original !== null} />
                      )}
                    </span>
                  )
                })}
              </div>
              <OriginBadge origin={e.origin} />
              {editMode && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${child.noun} ${i + 1}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={i === 0}
                      onSelect={() =>
                        write({ path: `${base}/${child.slug}/order`, method: "PUT", body: { ids: moveId(entries.map((x) => x.id), e.id, -1) }, reason: note, success: "Order saved" }).catch(() => {})
                      }
                    >
                      <ArrowUp /> Move up
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={i === entries.length - 1}
                      onSelect={() =>
                        write({ path: `${base}/${child.slug}/order`, method: "PUT", body: { ids: moveId(entries.map((x) => x.id), e.id, 1) }, reason: note, success: "Order saved" }).catch(() => {})
                      }
                    >
                      <ArrowDown /> Move down
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => setDelEntry(e)}>
                      <Trash2 /> Delete {child.noun}…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          )
        })}
      </ul>
      {editMode && (
        <Button variant="ghost" size="xs" className="m-1 justify-start text-muted-foreground" onClick={() => setAddEntry(true)}>
          <Plus /> Add {child.noun}
        </Button>
      )}

      {addEntry && (
        <RowFormSheet
          open
          onOpenChange={(o) => !o && setAddEntry(false)}
          title={`Add ${child.noun}`}
          description={`${def.title} · ${name ?? "(unnamed)"}`}
          fields={child.columns.map((c) => ({
            key: c.key,
            label: c.label,
            hint: def.key === "filters" && c.key === "label" ? "Optional. Legacy filter values have no labels." : undefined,
          }))}
          initial={{}}
          positions={{ count: entries.length, labelOf: (p) => entries[p - 1].current.value ?? "(no value)" }}
          initialReason={note}
          submitLabel={`Add ${child.noun}`}
          requireAny
          onSubmit={(values, reason, position) =>
            write({ path: `${base}/${child.slug}`, method: "POST", body: { ...values, position }, reason, success: `${child.noun[0].toUpperCase()}${child.noun.slice(1)} added` })
          }
        />
      )}
      {delEntry && (
        <ConfirmDelete
          open
          onOpenChange={(o) => !o && setDelEntry(null)}
          title={`Delete ${child.noun}?`}
          initialReason={note}
          description={
            <p>
              Remove {child.noun} #{entries.indexOf(delEntry) + 1} (<strong>{delEntry.current.value ?? "no value"}</strong>) from{" "}
              {name ?? "this group"}?
            </p>
          }
          onConfirm={(reason) => write({ path: `${base}/${child.slug}/${delEntry.id}`, method: "DELETE", reason, success: `${child.noun} deleted` })}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ section
export function GroupsSection({ def, section }: { def: SectionDef; section: Section<Group> }) {
  const { plant, write } = usePlantCtx()
  const { can } = useSession()
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState("")
  const [adding, setAdding] = useState(false)
  const [toDelete, setToDelete] = useState<Group | null>(null)
  const groups = section.items
  const editMode = can("edit") && editing
  const path = `plants/${plant.id}/${def.slug}`

  return (
    <SectionCard
      id={def.slug}
      title={def.title}
      icon={def.icon}
      count={groups.length}
      legacy={section.legacy}
      edit={{ editing, setEditing, note, setNote }}
      onAdd={() => setAdding(true)}
      addLabel={`Add ${def.noun}`}
    >
      {groups.length === 0 ? (
        <SectionEmpty legacy={section.legacy} noun={def.noun} canAdd={can("edit")} onAdd={() => { setEditing(true); setAdding(true) }} />
      ) : (
        <div className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-4">
          {groups.map((g, i) => (
            <GroupPanel
              key={g.id}
              def={def}
              group={g}
              index={i}
              total={groups.length}
              editMode={editMode}
              note={note}
              onMove={(d) =>
                write({ path: `${path}/order`, method: "PUT", body: { ids: moveId(groups.map((x) => x.id), g.id, d) }, reason: note, success: "Order saved" }).catch(() => {})
              }
              onDelete={() => setToDelete(g)}
            />
          ))}
        </div>
      )}
      {adding && <AddGroupSheet def={def} groups={groups} note={note} onClose={() => setAdding(false)} />}
      {toDelete && (
        <ConfirmDelete
          open
          onOpenChange={(o) => !o && setToDelete(null)}
          title={`Delete ${def.noun}?`}
          initialReason={note}
          description={
            <>
              <p>
                Remove <strong>{groupName(def, toDelete) ?? "(unnamed)"}</strong> and its {childrenOf(def, toDelete).length}{" "}
                {def.child!.noun}(s) from {def.title}?
              </p>
              {toDelete.origin === "legacy" && <p>The original legacy record is kept in the Legacy source view.</p>}
            </>
          }
          onConfirm={(reason) => write({ path: `${path}/${toDelete.id}`, method: "DELETE", reason, success: `${def.title}: ${def.noun} deleted` })}
        />
      )}
    </SectionCard>
  )
}
