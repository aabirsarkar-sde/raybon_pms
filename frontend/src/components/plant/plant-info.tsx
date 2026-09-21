"use client"

import { Factory, Settings2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { DiffValue, OriginBadge } from "@/components/common/value"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useZones } from "@/lib/api/hooks"
import type { ModuleRow, Text } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { PLANT_FIELDS, STAGE_LABELS } from "@/lib/sections"
import { cn } from "@/lib/utils"

import { InlineEditor, RowFormSheet } from "./editing"
import { usePlantCtx } from "./plant-context"
import { SectionCard } from "./section-card"

// ------------------------------------------------------------------ Plant
export function PlantInfoCard() {
  const { plant, write } = usePlantCtx()
  const zones = useZones()
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState("")
  const [zoneId, setZoneId] = useState<string>(plant.current.zone_id === null ? "none" : String(plant.current.zone_id))
  const c = plant.current
  const editable = PLANT_FIELDS.filter((f) => f.key !== "zone_name")

  return (
    <SectionCard id="plant" title="Plant" icon={Factory} edit={{ editing, setEditing, note, setNote }}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-3 text-sm sm:grid-cols-2">
        {PLANT_FIELDS.map((f) => (
          <div key={f.key} className={cn("min-w-0", f.key === "display_name" && "sm:col-span-2")}>
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className={cn("mt-0.5 break-words", f.mono && "font-mono text-[13px]")}>
              <DiffValue
                current={c[f.key]}
                original={plant.original?.[f.key]}
                hasOriginal={plant.original !== null}
              />
            </dd>
          </div>
        ))}
      </dl>
      {editing && (
        <RowFormSheet
          open
          onOpenChange={(o) => {
            if (!o) {
              setEditing(false)
              setZoneId(plant.current.zone_id === null ? "none" : String(plant.current.zone_id))
            }
          }}
          title="Edit plant details"
          description={plant.origin === "legacy" ? `Legacy plant #${plant.legacy_plant_id}` : "Added in the new system"}
          fields={editable.map((f) => ({
            key: f.key,
            label: f.label,
            mono: f.mono,
            original: (plant.original?.[f.key] as Text) ?? null,
            hasOriginal: plant.original !== null,
            hint: f.key === "name" ? "Required. Stored exactly as typed (the legacy system stored names in lower case)." : undefined,
          }))}
          initial={c as unknown as Record<string, Text>}
          initialReason={note}
          submitLabel="Save changes"
          onSubmit={(values, reason) => {
            if (values.name === null) {
              toast.error("Plant name is required")
              return Promise.reject(new Error("name required"))
            }
            const body: Record<string, unknown> = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== (c[k] ?? null)))
            const newZone = zoneId === "none" ? null : Number(zoneId)
            if (newZone !== c.zone_id) body.zone_id = newZone
            if (Object.keys(body).length === 0) return Promise.resolve()
            return write({
              path: `plants/${plant.id}`,
              method: "PATCH",
              body: { ...body, expected_updated_at: plant.updated_at },
              reason,
              success: "Plant details saved",
            })
          }}
        >
          <div className="grid gap-1.5">
            <Label>Zone</Label>
            <Select value={zoneId} onValueChange={setZoneId}>
              <SelectTrigger className="w-full" aria-label="Zone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No zone</SelectItem>
                {zones.data?.items.map((z) => (
                  <SelectItem key={z.id} value={String(z.id)}>
                    {z.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {plant.original && (
              <span className="text-xs text-muted-foreground">
                Legacy value: <span className="font-medium text-foreground/80">{String(plant.original.zone_name ?? "(no value)")}</span>
              </span>
            )}
          </div>
        </RowFormSheet>
      )}
    </SectionCard>
  )
}

// ------------------------------------------------------------------ Modules
function ModuleEditSheet({ row, note, onClose }: { row: ModuleRow; note: string; onClose: () => void }) {
  const { plant, write } = usePlantCtx()
  const [derive, setDerive] = useState(true)
  const stage = String(row.stage)
  return (
    <RowFormSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit ${STAGE_LABELS[stage]}`}
      description="Modules"
      fields={[
        { key: "value_text", label: "As recorded", original: row.original?.value_text ?? null, hasOriginal: row.original !== null, hint: "e.g. 3(HPRO), 2 (ST), 0" },
        ...(derive
          ? []
          : [
              { key: "quantity", label: "Quantity (whole number)" },
              { key: "module_type", label: "Type" },
            ]),
      ]}
      initial={{ value_text: row.current.value_text, quantity: row.current.quantity === null ? null : String(row.current.quantity), module_type: row.current.module_type }}
      initialReason={note}
      submitLabel="Save"
      onSubmit={(values, reason) => {
        const body: Record<string, unknown> = { value_text: values.value_text, expected_updated_at: row.updated_at }
        if (!derive) {
          if (values.quantity !== null && !/^\d+$/.test(values.quantity)) {
            toast.error("Quantity must be a whole number, or empty")
            return Promise.reject(new Error("quantity"))
          }
          body.quantity = values.quantity === null ? null : Number(values.quantity)
          body.module_type = values.module_type
        }
        return write({ path: `plants/${plant.id}/modules/${stage}`, method: "PATCH", body, reason, success: `${STAGE_LABELS[stage]} saved` })
      }}
    >
      <div className="flex items-start gap-2 rounded-md border p-2.5">
        <Switch id="derive" checked={derive} onCheckedChange={setDerive} />
        <Label htmlFor="derive" className="grid gap-0.5 text-sm font-normal">
          Work out quantity and type from the text
          <span className="text-xs text-muted-foreground">“3(HPRO)” → quantity 3, type HPRO. Turn off to enter them yourself.</span>
        </Label>
      </div>
    </RowFormSheet>
  )
}

export function ModulesCard() {
  const { plant, write } = usePlantCtx()
  const { can } = useSession()
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState("")
  const [cell, setCell] = useState<number | null>(null)
  const [sheet, setSheet] = useState<ModuleRow | null>(null)
  const editMode = can("edit") && editing

  return (
    <SectionCard id="modules" title="Modules" icon={Settings2} edit={{ editing, setEditing, note, setNote }}>
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-8 text-xs">Stage</TableHead>
            <TableHead className="h-8 text-xs">As recorded</TableHead>
            <TableHead className="h-8 text-right text-xs">Quantity</TableHead>
            <TableHead className="h-8 text-xs">Type</TableHead>
            <TableHead className="w-10" aria-label="Status" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {plant.modules.map((m) => {
            const stage = String(m.stage)
            const isTotal = m.stage === "total"
            const o = m.original
            return (
              <TableRow key={m.id} className={cn(isTotal && "border-t-2 bg-muted/30 font-medium")}>
                <TableCell className="py-1.5">{STAGE_LABELS[stage]}</TableCell>
                <TableCell
                  className={cn("py-1.5", editMode && cell !== m.id && "cursor-text hover:bg-accent/60")}
                  onClick={editMode && cell !== m.id ? () => setCell(m.id) : undefined}
                >
                  {cell === m.id ? (
                    <InlineEditor
                      initial={m.current.value_text}
                      label={`${STAGE_LABELS[stage]} value`}
                      onCancel={() => setCell(null)}
                      onSave={(v) =>
                        write({
                          path: `plants/${plant.id}/modules/${stage}`,
                          method: "PATCH",
                          body: { value_text: v, expected_updated_at: m.updated_at },
                          reason: note,
                          success: `${STAGE_LABELS[stage]} saved`,
                        })
                      }
                    />
                  ) : (
                    <DiffValue current={m.current.value_text} original={o?.value_text} hasOriginal={o !== null} />
                  )}
                </TableCell>
                <TableCell className="py-1.5 text-right tabular">
                  <DiffValue current={m.current.quantity} original={o?.quantity} hasOriginal={o !== null} />
                </TableCell>
                <TableCell className="py-1.5">
                  <DiffValue current={m.current.module_type} original={o?.module_type} hasOriginal={o !== null} />
                </TableCell>
                <TableCell className="py-1">
                  {editMode ? (
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSheet(m)}>
                      Edit…
                    </button>
                  ) : (
                    <OriginBadge origin={m.origin} modified={m.modified_fields.length > 0} />
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {sheet && <ModuleEditSheet row={sheet} note={note} onClose={() => setSheet(null)} />}
    </SectionCard>
  )
}
