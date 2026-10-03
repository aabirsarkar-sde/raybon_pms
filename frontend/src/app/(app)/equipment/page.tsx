import type { Metadata } from "next"
import { Suspense } from "react"

import { TableSkeleton } from "@/components/common/states"
import { EquipmentSearch } from "@/components/equipment/equipment-search"

export const metadata: Metadata = { title: "Equipment search" }

export default function EquipmentPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={10} />}>
      <EquipmentSearch />
    </Suspense>
  )
}
