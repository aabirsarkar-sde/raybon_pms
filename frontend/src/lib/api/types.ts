/** Types mirroring the PDM API (api/API.md). All data values are verbatim strings or null. */

export type Role = "viewer" | "editor" | "admin"
export interface User {
  /** Username (or API token name). */
  name: string
  username: string
  display_name: string | null
  role: Role
  auth: "password" | "token"
}

export interface Account {
  id: number
  username: string
  display_name: string | null
  role: Role
  is_active: boolean
  locked: boolean
  last_login_at: string | null
  password_changed_at: string
  created_at: string
  updated_at: string
}

export type Origin = "legacy" | "app"
export type Text = string | null

/** Every editable row: current (editable) vs original (immutable legacy value). */
export interface Row<C extends object = Record<string, Text>> {
  id: number
  position: number
  origin: Origin
  current: C
  original: (C & Record<string, unknown>) | null
  modified_fields: string[]
  derived?: Record<string, number | null>
  created_at: string
  updated_at: string
}

export interface LabelValue {
  label: Text
  value: Text
  [k: string]: Text
}
export type ChildRow = Row<LabelValue>
export interface FilterRow extends Row<{ name: Text }> {
  values: ChildRow[]
}
export interface HpGroupRow extends Row<{ group_name: Text }> {
  entries: ChildRow[]
}

export interface ModuleValues {
  value_text: Text
  quantity: number | null
  module_type: Text
}
export interface ModuleRow extends Row<ModuleValues> {
  stage: number | "total"
}

export interface LegacySectionInfo {
  rendered: boolean
  count: number | null
}

export type SectionKey =
  | "design_parameters"
  | "pumps_and_motors"
  | "instruments"
  | "hmi_plc"
  | "vfds"
  | "dosing_pumps"
  | "filters"
  | "hp_pump_accessories"

export interface Section<T = Row> {
  title: string
  endpoint: string
  legacy: LegacySectionInfo | null
  items: T[]
}

export interface PlantCurrent {
  name: string
  display_name: Text
  serial_number: Text
  capacity: Text
  site_contact_number: Text
  zone_id: number | null
  zone_name: Text
  [k: string]: Text | number | null
}

export interface PlantDoc {
  id: number
  legacy_plant_id: number | null
  origin: Origin
  current: PlantCurrent
  original: Record<string, Text> | null
  modified_fields: string[]
  created_at: string
  updated_at: string
  modules: ModuleRow[]
  sections: Record<SectionKey, Section<Row | FilterRow | HpGroupRow>>
  /** Number of documents in this plant's library. */
  documents: number
  links: Record<string, string>
}

export interface PlantListItem {
  id: number
  legacy_plant_id: number | null
  origin: Origin
  name: string
  display_name: Text
  serial_number: Text
  capacity: Text
  site_contact_number: Text
  zone: { id: number; name: string } | null
  has_changes: boolean
  documents: number
  counts: Record<SectionKey, number>
  created_at: string
  updated_at: string
  href: string
}

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface Zone {
  id: number
  name: string
  plant_count: number
}

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

export interface HistoryEntry {
  id: number
  table_name: string
  row_id: number
  operation: "INSERT" | "UPDATE" | "DELETE"
  column_name: string | null
  old_value: Json
  new_value: Json
  old_row: Record<string, Json> | null
  new_row: Record<string, Json> | null
  changed_by: string | null
  reason: string | null
  request_id: string | null
  changed_at: string
}

export interface LegacyRecord {
  id: number
  import_batch: { id: number; source_path: string; schema_version: string; imported_at: string }
  raw_file: string | null
  raw_sha256: string | null
  metadata_file: string | null
  endpoint: string | null
  http_status: number | null
  imported_at: string
  record: StructuredRecord
}

export interface LegacySnapshot {
  plant_id: number
  legacy_plant_id: number | null
  immutable: true
  records: LegacyRecord[]
}

/** plantdata_export/structured/plant_<id>.json */
export interface StructuredRecord {
  schema_version: string
  plant_id: number
  source: Record<string, Json>
  plant: { name: Text; serial_number: Text; capacity: Text; site_contact_number: Text }
  zone: Text
  modules: Record<string, Text>
  design_parameters: { position: number; name: Text; unit: Text; unit_raw: Text; value: Text }[] | null
  pump_and_motor: Record<string, Text>[] | null
  instruments: Record<string, Text>[] | null
  hmi_and_plc: Record<string, Text>[] | null
  vfd: Record<string, Text>[] | null
  dosing_pumps: Record<string, Text>[] | null
  filters: { position: number; name: Text; values: Text[] }[] | null
  hp_pump_accessories: { position: number; group: Text; entries: { label: Text; value: Text }[] }[] | null
  legacy_counts: Record<string, number | null>
}

// ===================================================================== equipment search

/** One searchable equipment list. `type` means something different in each. */
export type EquipmentKindKey =
  | "pumps"
  | "motors"
  | "instruments"
  | "hmi_plc"
  | "vfds"
  | "dosing_pumps"
  | "hp_pump_accessories"
  | "filters"

export interface EquipmentKind {
  kind: EquipmentKindKey
  label: string
  /** Heading for the `type` column, e.g. "Pump code", "Instrument". */
  type_label: string
  /** Collection slug, for linking to the section on the plant page. */
  slug: string
  section: SectionKey
  has_make: boolean
  has_model: boolean
}

export interface EquipmentKindCount extends EquipmentKind {
  items: number
  plants: number
}

/** A matching equipment row. Values are verbatim, as everywhere else. */
export interface EquipmentMatch {
  kind: EquipmentKindKey
  id: number
  position: number
  type: Text
  make: Text
  model: Text
  /** Extra verbatim values: motor kW/Amp, filter values, accessory group. */
  detail: { motor_kw?: string; motor_amp?: string; values?: string[]; group?: string; label?: string }
}

export interface EquipmentPlantGroup {
  plant: {
    id: number
    legacy_plant_id: number | null
    name: string
    display_name: Text
    serial_number: Text
    capacity: Text
    zone: { id: number; name: string } | null
  }
  /** Total matches in this plant (`matches` may be capped). */
  items: number
  matches: EquipmentMatch[]
}

export interface ZoneCount {
  zone: { id: number; name: string }
  items: number
  plants: number
}

/** One choice in a Make / Model / Type filter. */
export interface FacetValue {
  value: string
  items: number
  plants: number
  /** How many spellings differing only in case this option covers. */
  spellings: number
}

export type FacetDimension = "make" | "model" | "type"

export interface EquipmentSearchResult {
  /** Honours every filter. */
  summary: { items: number; plants: number; zones: number }
  plants: Page<EquipmentPlantGroup>
  /** Every zone, counted ignoring the zone filter so the zones stay comparable. */
  zones: ZoneCount[]
  unzoned: { items: number; plants: number }
  /** Every kind, counted ignoring the kind filter. */
  kinds: EquipmentKindCount[]
  /** Each facet is counted ignoring its own selection. */
  facets: Record<FacetDimension, FacetValue[]>
  facets_truncated: FacetDimension[]
  filters: {
    q: string | null
    kind: string[]
    make: string[]
    model: string[]
    type: string[]
    zone_id: number[]
    zone: string[]
    unzoned: boolean
  }
  sort: string
}

// ===================================================================== documents

export type DocumentCategory =
  | "pid"
  | "electrical"
  | "mechanical"
  | "layout"
  | "manual"
  | "datasheet"
  | "report"
  | "certificate"
  | "photo"
  | "other"

export interface PlantDocument {
  id: number
  plant_id: number
  category: DocumentCategory
  category_label: string
  title: string
  description: string | null
  file_name: string
  extension: string
  content_type: string
  byte_size: number
  sha256: string
  /** True when the browser may show it instead of downloading it. */
  can_preview: boolean
  uploaded_by: string | null
  created_at: string
  updated_at: string
  href: string
  download_href: string
}

export interface PlantDocumentList {
  items: PlantDocument[]
  total: number
  /** Counts for the whole library, not just the filtered view. */
  counts: Partial<Record<DocumentCategory, number>>
  total_bytes: number
}

export interface DocumentCategoryInfo {
  items: { key: DocumentCategory; label: string }[]
  allowed_extensions: string[]
  max_bytes: number
  storage: "db" | "fs"
}
