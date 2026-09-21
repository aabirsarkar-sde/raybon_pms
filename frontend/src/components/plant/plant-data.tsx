"use client"

import type { FilterRow, HpGroupRow, Row, Section } from "@/lib/api/types"
import { SECTION_BY_KEY } from "@/lib/sections"

import { GroupsSection } from "./groups-section"
import { usePlantCtx } from "./plant-context"
import { ModulesCard, PlantInfoCard } from "./plant-info"
import { TableSection } from "./table-section"

/** All sections of one plant, in the legacy page's order. */
export function PlantData() {
  const { plant } = usePlantCtx()
  const s = plant.sections
  const table = (k: "design_parameters" | "pumps_and_motors" | "instruments" | "hmi_plc" | "vfds" | "dosing_pumps") =>
    s[k] as Section<Row>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <PlantInfoCard />
          <ModulesCard />
        </div>
        <TableSection def={SECTION_BY_KEY.design_parameters} section={table("design_parameters")} />
      </div>
      <TableSection def={SECTION_BY_KEY.pumps_and_motors} section={table("pumps_and_motors")} />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <TableSection def={SECTION_BY_KEY.instruments} section={table("instruments")} />
        <TableSection def={SECTION_BY_KEY.hmi_plc} section={table("hmi_plc")} />
        <TableSection def={SECTION_BY_KEY.vfds} section={table("vfds")} />
        <TableSection def={SECTION_BY_KEY.dosing_pumps} section={table("dosing_pumps")} />
      </div>
      <GroupsSection def={SECTION_BY_KEY.hp_pump_accessories} section={s.hp_pump_accessories as Section<HpGroupRow>} />
      <GroupsSection def={SECTION_BY_KEY.filters} section={s.filters as Section<FilterRow>} />
    </div>
  )
}
