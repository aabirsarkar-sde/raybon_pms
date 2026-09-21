"use client"

import { useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { RowFormSheet } from "@/components/plant/editing"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, errorMessage } from "@/lib/api/client"
import { useZones } from "@/lib/api/hooks"
import type { PlantDoc } from "@/lib/api/types"
import { PLANT_FIELDS } from "@/lib/sections"

/** Admin only: create a plant that did not exist in the legacy system. */
export function CreatePlantSheet() {
  const [open, setOpen] = useState(false)
  const [zoneId, setZoneId] = useState("none")
  const zones = useZones()
  const router = useRouter()
  const qc = useQueryClient()

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> New plant
      </Button>
      {open && (
        <RowFormSheet
          open
          onOpenChange={setOpen}
          title="New plant"
          description="Creates a plant that did not exist in the legacy system. Serial numbers do not need to be unique."
          fields={PLANT_FIELDS.filter((f) => f.key !== "zone_name").map((f) => ({
            key: f.key,
            label: f.key === "name" ? "Plant name (required)" : f.label,
            mono: f.mono,
          }))}
          initial={{}}
          submitLabel="Create plant"
          onSubmit={async (values, reason) => {
            if (values.name === null) {
              toast.error("Plant name is required")
              throw new Error("name required")
            }
            try {
              const doc = await api<PlantDoc>("plants", {
                method: "POST",
                body: { ...values, zone_id: zoneId === "none" ? null : Number(zoneId) },
                reason,
              })
              toast.success("Plant created")
              await qc.invalidateQueries({ queryKey: ["plants"] })
              router.push(`/plants/${doc.id}`)
            } catch (e) {
              toast.error("Plant not created", { description: errorMessage(e) })
              throw e
            }
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
          </div>
        </RowFormSheet>
      )}
    </>
  )
}
