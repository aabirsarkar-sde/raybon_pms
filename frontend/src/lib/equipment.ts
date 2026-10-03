import { Activity, Cable, Cpu, Droplets, Filter, Gauge, type LucideIcon, Wrench, Zap } from "lucide-react"

import type { EquipmentKindKey, EquipmentMatch } from "@/lib/api/types"

/**
 * Icons for the searchable equipment lists. Labels, column headings and which
 * lists exist all come from the API (GET /equipment/kinds), so the two never
 * drift apart; only the icons are a front-end choice.
 */
export const KIND_ICON: Record<EquipmentKindKey, LucideIcon> = {
  pumps: Gauge,
  motors: Zap,
  instruments: Activity,
  hmi_plc: Cpu,
  vfds: Cable,
  dosing_pumps: Droplets,
  hp_pump_accessories: Wrench,
  filters: Filter,
}

/** Order the kind filter is offered in: the lists people search most, first. */
export const KIND_ORDER: EquipmentKindKey[] = [
  "pumps",
  "motors",
  "instruments",
  "hmi_plc",
  "vfds",
  "dosing_pumps",
  "hp_pump_accessories",
  "filters",
]

/**
 * The extra values a match carries, as label/value pairs for display.
 * Values stay verbatim — nothing is reformatted, as everywhere else in the app.
 */
export function describeDetail(match: EquipmentMatch): { label: string; value: string }[] {
  const d = match.detail ?? {}
  const out: { label: string; value: string }[] = []
  if (d.group && d.group !== match.type) out.push({ label: "Group", value: d.group })
  if (d.motor_kw) out.push({ label: "kW", value: d.motor_kw })
  if (d.motor_amp) out.push({ label: "Amp", value: d.motor_amp })
  if (d.values?.length) out.push({ label: "Values", value: d.values.join(" · ") })
  return out
}

/** "1.4 MB", "812 kB" — for document sizes. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
