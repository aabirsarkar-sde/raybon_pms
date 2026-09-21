"use client"

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { api, ApiError, errorMessage, type RequestOptions } from "./client"
import type { HistoryEntry, LegacySnapshot, Page, PlantDoc, PlantListItem, Zone } from "./types"

export interface PlantSearch {
  q?: string
  serial_number?: string
  zone_id?: number
  modified?: boolean
  origin?: "legacy" | "app"
  equipment?: string
  sort?: string
  limit?: number
  offset?: number
}

export const keys = {
  plants: (p: PlantSearch) => ["plants", p] as const,
  plant: (id: number) => ["plant", id] as const,
  history: (id: number) => ["history", id] as const,
  legacy: (id: number) => ["legacy", id] as const,
  zones: ["zones"] as const,
}

export function usePlants(params: PlantSearch, enabled = true) {
  return useQuery({
    queryKey: keys.plants(params),
    queryFn: ({ signal }) => api<Page<PlantListItem>>("plants", { params: { ...params }, signal }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function usePlant(id: number) {
  return useQuery({
    queryKey: keys.plant(id),
    queryFn: ({ signal }) => api<PlantDoc>(`plants/${id}`, { signal }),
  })
}

export function useZones() {
  return useQuery({ queryKey: keys.zones, queryFn: () => api<{ items: Zone[] }>("zones"), staleTime: 5 * 60_000 })
}

export function useLegacy(id: number) {
  return useQuery({
    queryKey: keys.legacy(id),
    queryFn: () => api<LegacySnapshot>(`plants/${id}/legacy`),
    staleTime: Infinity, // immutable
  })
}

const HISTORY_PAGE = 200

export function useHistory(id: number) {
  return useInfiniteQuery({
    queryKey: keys.history(id),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api<Page<HistoryEntry>>(`plants/${id}/history`, { params: { limit: HISTORY_PAGE, offset: pageParam }, signal }),
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
  })
}

export interface WriteRequest {
  path: string
  method: "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  reason?: string | null
  /** Toast shown on success; omit for silent writes. */
  success?: string
}

/**
 * Every write for a plant goes through here: sends the request, shows a toast,
 * and refreshes the plant document, its history and list views.
 * On 409 (someone else changed the row) the fresh data is loaded automatically.
 */
export function usePlantWrite(plantId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (req: WriteRequest) =>
      api<unknown>(req.path, { method: req.method, body: req.body, reason: req.reason } satisfies RequestOptions),
    onSuccess: (_data, req) => {
      if (req.success) toast.success(req.success)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isConflict) {
        toast.error("Someone else changed this record", {
          description: `${errorMessage(e)} The latest data has been loaded — please review and re-apply your change.`,
        })
      } else {
        toast.error("Change not saved", { description: errorMessage(e) })
      }
    },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.plant(plantId) }),
        qc.invalidateQueries({ queryKey: keys.history(plantId) }),
        qc.invalidateQueries({ queryKey: ["plants"] }),
      ])
    },
  })
}
