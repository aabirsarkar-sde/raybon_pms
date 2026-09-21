/**
 * Turns raw change_log rows into readable change sets.
 * Nothing here alters values — they are displayed exactly as logged.
 */
import type { HistoryEntry, Json, PlantDoc, Zone } from "@/lib/api/types"
import { PLANT_FIELDS, SECTIONS, STAGE_LABELS } from "@/lib/sections"

export interface Area {
  key: string
  title: string
  noun: string
  labelField: string
  fields: Record<string, string>
  parentTable?: string
  parentFk?: string
}

const DERIVED = new Set(["value_numeric", "motor_kw_numeric", "motor_amp_numeric", "updated_at", "created_at"])

export const AREAS: Record<string, Area> = {
  plants: {
    key: "plant",
    title: "Plant",
    noun: "plant",
    labelField: "name",
    fields: { ...Object.fromEntries(PLANT_FIELDS.map((f) => [f.key, f.label])), zone_id: "Zone" },
  },
  plant_modules: {
    key: "modules",
    title: "Modules",
    noun: "stage",
    labelField: "stage",
    fields: { value_text: "As recorded", quantity: "Quantity", module_type: "Type" },
  },
}
for (const s of SECTIONS) {
  AREAS[s.table] = {
    key: s.key,
    title: s.title,
    noun: s.noun,
    labelField: s.labelField,
    fields: Object.fromEntries(s.columns.map((c) => [c.key, c.label])),
  }
  if (s.child) {
    AREAS[s.child.table] = {
      key: s.key,
      title: s.title,
      noun: s.child.noun,
      labelField: "value",
      fields: Object.fromEntries(s.child.columns.map((c) => [c.key, c.label])),
      parentTable: s.table,
      parentFk: s.child.key === "values" ? "filter_id" : "group_id",
    }
  }
}

export type Change =
  | { kind: "update"; entry: HistoryEntry; area: Area; row: string; field: string; old: Json; new: Json }
  | { kind: "insert" | "delete"; entry: HistoryEntry; area: Area; row: string; values: [string, Json][] }
  | { kind: "reorder"; area: Area; row: string; count: number }

export interface ChangeSet {
  key: string
  requestId: string | null
  who: string | null
  reason: string | null
  at: string
  changes: Change[]
  areas: string[]
}

/** Index of "table:id" -> human label, built from the current plant and the log itself. */
function buildLabels(plant: PlantDoc, entries: HistoryEntry[]) {
  const labels = new Map<string, string>()
  const parents = new Map<string, number>() // child "table:id" -> parent id
  labels.set(`plants:${plant.id}`, plant.current.display_name ?? plant.current.name)
  for (const m of plant.modules) labels.set(`plant_modules:${m.id}`, STAGE_LABELS[String(m.stage)])
  for (const s of SECTIONS) {
    for (const item of plant.sections[s.key].items) {
      const v = (item.current as Record<string, Json>)[s.labelField]
      labels.set(`${s.table}:${item.id}`, v ? String(v) : `#${item.position}`)
      if (s.child) {
        const kids = (item as unknown as Record<string, { id: number; position: number; current: Record<string, Json> }[]>)[s.child.key] ?? []
        for (const k of kids) {
          labels.set(`${s.child.table}:${k.id}`, k.current.value ? String(k.current.value) : `#${k.position}`)
          parents.set(`${s.child.table}:${k.id}`, item.id)
        }
      }
    }
  }
  // Rows that no longer exist: use the logged row images.
  for (const e of entries) {
    const row = e.new_row ?? e.old_row
    if (!row) continue
    const area = AREAS[e.table_name]
    const k = `${e.table_name}:${e.row_id}`
    if (!labels.has(k) && area) {
      const v = e.table_name === "plant_modules" ? STAGE_LABELS[row.is_total ? "total" : String(row.stage)] : row[area.labelField]
      labels.set(k, v ? String(v) : `#${row.position ?? e.row_id}`)
    }
    if (area?.parentFk && row[area.parentFk] != null) parents.set(k, Number(row[area.parentFk]))
  }
  return { labels, parents }
}

function summarize(row: Record<string, Json> | null, area: Area): [string, Json][] {
  if (!row) return []
  return Object.entries(area.fields)
    .filter(([k]) => row[k] !== null && row[k] !== undefined)
    .map(([k, label]) => [label, row[k]])
}

export function describe(plant: PlantDoc, entries: HistoryEntry[], zones: Zone[] = []): ChangeSet[] {
  const { labels, parents } = buildLabels(plant, entries)
  const zoneName = (v: Json) => (v === null ? null : (zones.find((z) => z.id === v)?.name ?? `Zone #${v}`))

  const rowLabel = (e: HistoryEntry, area: Area) => {
    const own = labels.get(`${e.table_name}:${e.row_id}`) ?? `#${e.row_id}`
    if (!area.parentTable) return own
    const pid = parents.get(`${e.table_name}:${e.row_id}`)
    const parent = pid !== undefined ? labels.get(`${area.parentTable}:${pid}`) : undefined
    return parent ? `${parent} › ${own}` : own
  }

  const groups = new Map<string, HistoryEntry[]>()
  for (const e of entries) {
    const key = e.request_id ?? `${e.changed_by}|${e.changed_at.slice(0, 19)}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }

  const sets: ChangeSet[] = []
  for (const [key, es] of groups) {
    const structural = new Set(es.filter((e) => e.operation !== "UPDATE").map((e) => e.table_name))
    const reorders = new Map<string, number>()
    const changes: Change[] = []
    for (const e of [...es].sort((a, b) => a.id - b.id)) {
      const area = AREAS[e.table_name]
      if (!area) continue
      if (e.operation === "UPDATE") {
        const col = e.column_name ?? ""
        if (DERIVED.has(col)) continue
        if (col === "position") {
          // Shifts caused by an insert/delete in the same request are implied; plain reorders are summarised.
          if (!structural.has(e.table_name)) reorders.set(e.table_name, (reorders.get(e.table_name) ?? 0) + 1)
          continue
        }
        const isZone = e.table_name === "plants" && col === "zone_id"
        changes.push({
          kind: "update",
          entry: e,
          area,
          row: rowLabel(e, area),
          field: area.fields[col] ?? col,
          old: isZone ? zoneName(e.old_value) : e.old_value,
          new: isZone ? zoneName(e.new_value) : e.new_value,
        })
      } else {
        const img = e.operation === "INSERT" ? e.new_row : e.old_row
        changes.push({
          kind: e.operation === "INSERT" ? "insert" : "delete",
          entry: e,
          area,
          row: rowLabel(e, area),
          values: summarize(img, area),
        })
      }
    }
    for (const [table, count] of reorders) {
      const area = AREAS[table]
      const sample = es.find((e) => e.table_name === table)!
      const parentLabel = area.parentTable
        ? labels.get(`${area.parentTable}:${parents.get(`${table}:${sample.row_id}`)}`)
        : undefined
      changes.push({ kind: "reorder", area, row: parentLabel ?? "", count })
    }
    if (changes.length === 0) continue
    const first = es[0]
    sets.push({
      key,
      requestId: first.request_id,
      who: first.changed_by,
      reason: first.reason,
      at: es.reduce((a, e) => (e.changed_at > a ? e.changed_at : a), first.changed_at),
      changes,
      areas: [...new Set(changes.map((c) => c.area.title))],
    })
  }
  return sets.sort((a, b) => (a.at < b.at ? 1 : -1))
}
