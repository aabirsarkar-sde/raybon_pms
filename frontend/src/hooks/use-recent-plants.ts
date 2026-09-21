"use client"

import { useCallback, useSyncExternalStore } from "react"

export interface RecentPlant {
  id: number
  label: string
  serial: string | null
}

const KEY = "pdm.recentPlants"
const MAX = 6
const listeners = new Set<() => void>()
let cache: RecentPlant[] | null = null

function read(): RecentPlant[] {
  if (cache) return cache
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentPlant[]
  } catch {
    cache = []
  }
  return cache
}

const EMPTY: RecentPlant[] = []

/** Recently opened plants (per browser; a convenience only). */
export function useRecentPlants() {
  const items = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
    () => EMPTY,
  )
  const remember = useCallback((p: RecentPlant) => {
    const next = [p, ...read().filter((x) => x.id !== p.id)].slice(0, MAX)
    cache = next
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable */
    }
    listeners.forEach((l) => l())
  }, [])
  return { items, remember }
}
