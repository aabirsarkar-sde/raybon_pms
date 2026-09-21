import {
  Activity,
  Cable,
  Cpu,
  Droplets,
  Filter,
  Gauge,
  type LucideIcon,
  Settings2,
  SlidersHorizontal,
  Wrench,
} from "lucide-react"

import type { SectionKey } from "@/lib/api/types"

export interface ColumnDef {
  key: string
  label: string
  /** Render in monospace (codes, models). */
  mono?: boolean
  /** Name of a derived numeric column shown as a hint. */
  numeric?: string
  className?: string
}

export interface ChildDef {
  slug: "values" | "entries"
  key: "values" | "entries"
  noun: string
  table: string
  columns: ColumnDef[]
}

export interface SectionDef {
  key: SectionKey
  slug: string
  /** Heading used in the new UI. */
  title: string
  /** Heading in the legacy system (shown in the Legacy Source view). */
  legacyTitle: string
  /** Label of the legacy header counter ("Pump:", "Instruments:" ...). */
  counter?: string
  noun: string
  icon: LucideIcon
  kind: "params" | "table" | "groups"
  table: string
  columns: ColumnDef[]
  /** Field shown as the row's name in history/confirmations. */
  labelField: string
  child?: ChildDef
  /** Key of this section in the structured legacy record. */
  legacyKey: string
}

const nameMakeModel: ColumnDef[] = [
  { key: "name", label: "Name" },
  { key: "make", label: "Make" },
  { key: "model", label: "Model", mono: true },
]

export const SECTIONS: SectionDef[] = [
  {
    key: "design_parameters",
    slug: "design-parameters",
    title: "Design Parameters",
    legacyTitle: "Design Parameters",
    noun: "parameter",
    icon: SlidersHorizontal,
    kind: "params",
    table: "plant_design_parameters",
    labelField: "parameter_name",
    legacyKey: "design_parameters",
    columns: [
      { key: "parameter_name", label: "Parameter" },
      { key: "value", label: "Value", numeric: "value_numeric", className: "tabular" },
      { key: "unit", label: "Unit" },
    ],
  },
  {
    key: "pumps_and_motors",
    slug: "pumps-and-motors",
    title: "Pump & Motor",
    legacyTitle: "Pump And Motor",
    counter: "Pump",
    noun: "pump",
    icon: Gauge,
    kind: "table",
    table: "pumps_and_motors",
    labelField: "equipment_code",
    legacyKey: "pump_and_motor",
    columns: [
      { key: "equipment_code", label: "Pump Code", mono: true },
      { key: "pump_make", label: "Pump Make" },
      { key: "pump_model", label: "Pump Model", mono: true },
      { key: "motor_make", label: "Motor Make" },
      { key: "motor_kw", label: "Motor kW", numeric: "motor_kw_numeric", className: "tabular" },
      { key: "motor_amp", label: "Motor Amp.", numeric: "motor_amp_numeric", className: "tabular" },
    ],
  },
  {
    key: "instruments",
    slug: "instruments",
    title: "Instruments",
    legacyTitle: "Instruments",
    counter: "Instruments",
    noun: "instrument",
    icon: Activity,
    kind: "table",
    table: "instruments",
    labelField: "name",
    legacyKey: "instruments",
    columns: nameMakeModel,
  },
  {
    key: "hmi_plc",
    slug: "hmi-plc",
    title: "HMI & PLC",
    legacyTitle: "HMI and PLC",
    counter: "HMI And PLC",
    noun: "HMI / PLC item",
    icon: Cpu,
    kind: "table",
    table: "hmi_plc",
    labelField: "name",
    legacyKey: "hmi_and_plc",
    columns: nameMakeModel,
  },
  {
    key: "vfds",
    slug: "vfds",
    title: "VFD",
    legacyTitle: "VFD",
    counter: "VFD",
    noun: "VFD",
    icon: Cable,
    kind: "table",
    table: "vfds",
    labelField: "name",
    legacyKey: "vfd",
    columns: nameMakeModel,
  },
  {
    key: "dosing_pumps",
    slug: "dosing-pumps",
    title: "Dosing Pumps",
    legacyTitle: "Dosing Pump",
    counter: "Dosing Pump",
    noun: "dosing pump",
    icon: Droplets,
    kind: "table",
    table: "dosing_pumps",
    labelField: "dosing_pump_for",
    legacyKey: "dosing_pumps",
    columns: [
      { key: "dosing_pump_for", label: "Dosing Pump For" },
      { key: "make", label: "Make" },
      { key: "model", label: "Model", mono: true },
    ],
  },
  {
    key: "hp_pump_accessories",
    slug: "hp-pump-accessories",
    title: "HP Pump Accessories",
    legacyTitle: "HP Pump Accessories",
    counter: "HP Pump Accessories",
    noun: "accessory group",
    icon: Wrench,
    kind: "groups",
    table: "hp_pump_accessory_groups",
    labelField: "group_name",
    legacyKey: "hp_pump_accessories",
    columns: [{ key: "group_name", label: "Group" }],
    child: {
      slug: "entries",
      key: "entries",
      noun: "entry",
      table: "hp_pump_accessory_entries",
      columns: [
        { key: "label", label: "Label" },
        { key: "value", label: "Value" },
      ],
    },
  },
  {
    key: "filters",
    slug: "filters",
    title: "Filters",
    legacyTitle: "Filters",
    counter: "Filters",
    noun: "filter",
    icon: Filter,
    kind: "groups",
    table: "filters",
    labelField: "name",
    legacyKey: "filters",
    columns: [{ key: "name", label: "Filter" }],
    child: {
      slug: "values",
      key: "values",
      noun: "value",
      table: "filter_values",
      columns: [
        { key: "label", label: "Label" },
        { key: "value", label: "Value" },
      ],
    },
  },
]

export const SECTION_BY_KEY = Object.fromEntries(SECTIONS.map((s) => [s.key, s])) as Record<SectionKey, SectionDef>

/** Legacy header counters in legacy order. */
export const COUNTER_ORDER: SectionKey[] = [
  "pumps_and_motors",
  "instruments",
  "hmi_plc",
  "vfds",
  "dosing_pumps",
  "filters",
  "hp_pump_accessories",
]

export const PLANT_FIELDS: { key: string; label: string; legacyLabel: string; mono?: boolean }[] = [
  { key: "name", label: "Plant name", legacyLabel: "Plant" },
  { key: "display_name", label: "Display name", legacyLabel: "Dropdown label" },
  { key: "serial_number", label: "Serial number", legacyLabel: "Plant Serial Number", mono: true },
  { key: "capacity", label: "Capacity", legacyLabel: "Plant Capacity" },
  { key: "site_contact_number", label: "Site contact", legacyLabel: "Site Contact Number", mono: true },
  { key: "zone_name", label: "Zone", legacyLabel: "Zone" },
]

export const STAGE_LABELS: Record<string, string> = {
  "1": "1st Stage",
  "2": "2nd Stage",
  "3": "3rd Stage",
  "4": "4th Stage",
  "5": "5th Stage",
  total: "Total",
}

export const MODULE_ICON = Settings2
