"use client"

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { DiffValue, OriginBadge } from "@/components/common/value"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Row, Section, Text } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import type { SectionDef } from "@/lib/sections"
import { cn } from "@/lib/utils"

import { ConfirmDelete, DragHandle, InlineEditor, moveId, RowFormSheet } from "./editing"
import { usePlantCtx } from "./plant-context"
import { SectionCard, SectionEmpty } from "./section-card"

type SheetState = { mode: "add" } | { mode: "edit"; row: Row } | null

export function rowLabel(def: SectionDef, row: Row): string {
  const v = row.current[def.labelField as keyof typeof row.current]
  return v ? String(v) : `#${row.position}`
}

/** Keeps a locally re-ordered list until the server's copy arrives. */
function useOrderedRows<T extends { id: number }>(items: T[]) {
  const serverKey = items.map((r) => r.id).join(",")
  // A local order only applies to the server list it was made from.
  const [local, setLocal] = useState<{ key: string; order: number[] } | null>(null)
  const order = local && local.key === serverKey ? local.order : null
  const rows = useMemo(() => {
    if (!order) return items
    const byId = new Map(items.map((r) => [r.id, r]))
    return order.map((id) => byId.get(id)).filter(Boolean) as T[]
  }, [items, order])
  const setOrder = (ids: number[] | null) => setLocal(ids ? { key: serverKey, order: ids } : null)
  return { rows, setOrder }
}

function SortableTr({
  row,
  editing,
  className,
  children,
}: {
  row: Row
  editing: boolean
  className?: string
  children: (handle: React.ReactNode) => React.ReactNode
}) {
  const { setNodeRef, transform, transition, isDragging, attributes, listeners } = useSortable({ id: row.id, disabled: !editing })
  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, position: "relative", zIndex: isDragging ? 10 : undefined }}
      className={cn(className, isDragging && "bg-accent shadow-md")}
      data-row-id={row.id}
    >
      {children(<DragHandle {...attributes} {...listeners} />)}
    </TableRow>
  )
}

export function TableSection({ def, section, className }: { def: SectionDef; section: Section<Row>; className?: string }) {
  const { plant, write } = usePlantCtx()
  const { can } = useSession()
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState("")
  const [cellState, setCell] = useState<{ id: number; key: string } | null>(null)
  const [sheet, setSheet] = useState<SheetState>(null)
  const [toDelete, setToDelete] = useState<Row | null>(null)
  const { rows, setOrder } = useOrderedRows(section.items)
  const path = `plants/${plant.id}/${def.slug}`
  const isParams = def.kind === "params"
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Repeated parameter names are preserved; flag them so they are not mistaken for errors.
  const nameCounts = useMemo(() => {
    const m = new Map<string, number>()
    if (isParams) for (const r of rows) {
      const n = r.current.parameter_name
      if (n) m.set(n, (m.get(n) ?? 0) + 1)
    }
    return m
  }, [rows, isParams])

  async function reorder(ids: number[]) {
    setOrder(ids)
    try {
      await write({ path: `${path}/order`, method: "PUT", body: { ids }, reason: note, success: "Order saved" })
    } catch {
      setOrder(null)
    }
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    const ids = rows.map((r) => r.id)
    const from = ids.indexOf(Number(e.active.id))
    const to = ids.indexOf(Number(e.over.id))
    const next = [...ids]
    next.splice(to, 0, ...next.splice(from, 1))
    void reorder(next)
  }

  const saveCell = (row: Row, key: string) => (value: Text) =>
    write({
      path: `${path}/${row.id}`,
      method: "PATCH",
      body: { [key]: value, expected_updated_at: row.updated_at },
      reason: note,
      success: "Saved",
    })

  const canEdit = can("edit")
  const editMode = canEdit && editing
  const cell = editMode ? cellState : null
  const count = rows.length

  return (
    <SectionCard
      id={def.slug}
      title={def.title}
      icon={def.icon}
      count={count}
      legacy={section.legacy}
      edit={{ editing, setEditing, note, setNote }}
      onAdd={() => setSheet({ mode: "add" })}
      addLabel={`Add ${def.noun}`}
      className={className}
    >
      {count === 0 ? (
        <SectionEmpty legacy={section.legacy} noun={def.noun} canAdd={canEdit} onAdd={() => { setEditing(true); setSheet({ mode: "add" }) }} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {editMode && <TableHead className="w-6 px-1" aria-label="Reorder" />}
                <TableHead className="w-8 text-right text-xs text-muted-foreground">#</TableHead>
                {def.columns.map((c) => (
                  <TableHead key={c.key} className="h-8 text-xs">
                    {c.label}
                  </TableHead>
                ))}
                <TableHead className="w-12" aria-label="Status" />
                {editMode && <TableHead className="w-10" aria-label="Actions" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                {rows.map((row, idx) => (
                  <SortableTr
                    key={row.id}
                    row={row}
                    editing={editMode}
                    className={cn(
                      row.origin === "app" && "bg-added-subtle/50 shadow-[inset_3px_0_0_var(--added)]",
                      row.origin === "legacy" && row.modified_fields.length > 0 && "shadow-[inset_3px_0_0_var(--modified)]",
                    )}
                  >
                    {(handle) => (
                      <>
                        {editMode && <TableCell className="w-6 px-1">{handle}</TableCell>}
                        <TableCell className="py-1.5 text-right text-xs text-muted-foreground tabular">{idx + 1}</TableCell>
                        {def.columns.map((c) => {
                          const key = c.key
                          const value = row.current[key] ?? null
                          const isCell = cell?.id === row.id && cell.key === key
                          return (
                            <TableCell
                              key={key}
                              className={cn(
                                "py-1.5 align-top whitespace-normal",
                                c.className,
                                editMode && !isCell && "cursor-text hover:bg-accent/60",
                              )}
                              onClick={editMode && !isCell ? () => setCell({ id: row.id, key }) : undefined}
                              title={editMode && !isCell ? "Click to edit" : undefined}
                            >
                              {isCell ? (
                                <InlineEditor
                                  initial={value}
                                  label={`${c.label} of ${rowLabel(def, row)}`}
                                  mono={c.mono}
                                  onSave={saveCell(row, key)}
                                  onCancel={() => setCell(null)}
                                />
                              ) : (
                                <span className="inline-flex flex-wrap items-center gap-1.5">
                                  <DiffValue
                                    current={value}
                                    original={row.original?.[key] as Text | undefined}
                                    hasOriginal={row.original !== null}
                                    mono={c.mono}
                                  />
                                  {isParams && key === "parameter_name" && value && (nameCounts.get(value) ?? 0) > 1 && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Badge variant="outline" className="h-4 px-1 text-[10px] text-muted-foreground">
                                          ×{nameCounts.get(value)}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>This parameter name appears {nameCounts.get(value)} times; each entry is kept.</TooltipContent>
                                    </Tooltip>
                                  )}
                                  {isParams && key === "unit" && row.original?.unit_raw != null && (
                                    <span className="sr-only">Legacy text: {String(row.original.unit_raw)}</span>
                                  )}
                                </span>
                              )}
                            </TableCell>
                          )
                        })}
                        <TableCell className="py-1.5">
                          <OriginBadge origin={row.origin} modified={row.modified_fields.length > 0} />
                        </TableCell>
                        {editMode && (
                          <TableCell className="py-1">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon-xs" variant="ghost" aria-label={`Actions for ${rowLabel(def, row)}`}>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setSheet({ mode: "edit", row })}>
                                  <Pencil /> Edit row…
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled={idx === 0} onSelect={() => reorder(moveId(rows.map((r) => r.id), row.id, -1))}>
                                  <ArrowUp /> Move up
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={idx === rows.length - 1}
                                  onSelect={() => reorder(moveId(rows.map((r) => r.id), row.id, 1))}
                                >
                                  <ArrowDown /> Move down
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onSelect={() => setToDelete(row)}>
                                  <Trash2 /> Delete…
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </>
                    )}
                  </SortableTr>
                ))}
              </SortableContext>
            </TableBody>
          </Table>
        </DndContext>
      )}

      {sheet && (
        <RowFormSheet
          open
          onOpenChange={(o) => !o && setSheet(null)}
          title={sheet.mode === "add" ? `Add ${def.noun}` : `Edit ${def.noun}`}
          description={
            sheet.mode === "edit" ? (
              <>
                {def.title} · row {rows.findIndex((r) => r.id === sheet.row.id) + 1}
                {sheet.row.origin === "legacy" ? " · imported from the legacy system" : " · added in the new system"}
              </>
            ) : (
              def.title
            )
          }
          fields={def.columns.map((c) => ({
            key: c.key,
            label: c.label,
            mono: c.mono,
            original: sheet.mode === "edit" ? ((sheet.row.original?.[c.key] as Text | undefined) ?? null) : undefined,
            hasOriginal: sheet.mode === "edit" && sheet.row.original !== null,
            hint:
              isParams && c.key === "unit" && sheet.mode === "edit" && sheet.row.original?.unit_raw != null
                ? `Shown in the legacy system as “${String(sheet.row.original.unit_raw)}”.`
                : undefined,
          }))}
          initial={sheet.mode === "edit" ? (sheet.row.current as Record<string, Text>) : {}}
          positions={sheet.mode === "add" ? { count: rows.length, labelOf: (p) => rowLabel(def, rows[p - 1]) } : undefined}
          initialReason={note}
          submitLabel={sheet.mode === "add" ? `Add ${def.noun}` : "Save changes"}
          requireAny={sheet.mode === "add"}
          onSubmit={(values, reason, position) => {
            if (sheet.mode === "add") {
              return write({ path, method: "POST", body: { ...values, position }, reason, success: `${def.title}: ${def.noun} added` })
            }
            const changed = Object.fromEntries(
              Object.entries(values).filter(([k, v]) => v !== ((sheet.row.current as Record<string, Text>)[k] ?? null)),
            )
            return write({
              path: `${path}/${sheet.row.id}`,
              method: "PATCH",
              body: { ...changed, expected_updated_at: sheet.row.updated_at },
              reason,
              success: "Changes saved",
            })
          }}
        />
      )}

      {toDelete && (
        <ConfirmDelete
          open
          onOpenChange={(o) => !o && setToDelete(null)}
          title={`Delete ${def.noun}?`}
          initialReason={note}
          description={
            <>
              <p>
                Remove <strong>{rowLabel(def, toDelete)}</strong> from {def.title}?
              </p>
              {toDelete.origin === "legacy" && (
                <p>The original legacy record is kept in the Legacy source view and the deletion is recorded in history.</p>
              )}
            </>
          }
          onConfirm={(reason) =>
            write({ path: `${path}/${toDelete.id}`, method: "DELETE", reason, success: `${def.title}: ${def.noun} deleted` })
          }
        />
      )}
    </SectionCard>
  )
}
