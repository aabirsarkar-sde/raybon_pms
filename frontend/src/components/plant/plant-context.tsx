"use client"

import { createContext, useContext } from "react"

import type { WriteRequest } from "@/lib/api/hooks"
import type { PlantDoc } from "@/lib/api/types"

export interface PlantCtx {
  plant: PlantDoc
  /** Every write for this plant. Rejects on error (a toast has already been shown). */
  write: (req: WriteRequest) => Promise<unknown>
  base: string
}

export const PlantContext = createContext<PlantCtx | null>(null)

export function usePlantCtx(): PlantCtx {
  const c = useContext(PlantContext)
  if (!c) throw new Error("usePlantCtx must be used inside a plant page")
  return c
}
