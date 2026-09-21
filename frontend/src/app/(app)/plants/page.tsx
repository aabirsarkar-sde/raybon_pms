import type { Metadata } from "next"
import { Suspense } from "react"

import { TableSkeleton } from "@/components/common/states"
import { PlantList } from "@/components/plants/plant-list"

export const metadata: Metadata = { title: "Plants" }

export default function PlantsPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={10} />}>
      <PlantList />
    </Suspense>
  )
}
