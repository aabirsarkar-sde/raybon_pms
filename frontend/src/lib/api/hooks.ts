"use client"

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { api, ApiError, errorMessage, type ListParams, type RequestOptions } from "./client"
import type {
  DocumentCategoryInfo,
  EquipmentKind,
  EquipmentSearchResult,
  HistoryEntry,
  LegacySnapshot,
  Page,
  PlantDoc,
  PlantDocumentList,
  PlantListItem,
  Zone,
} from "./types"

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

export interface EquipmentQuery extends ListParams {
  q?: string
  kind?: string[]
  make?: string[]
  model?: string[]
  type?: string[]
  zone_id?: number[]
  unzoned?: boolean
  sort?: string
  limit?: number
  offset?: number
  matches?: number
}

export const keys = {
  plants: (p: PlantSearch) => ["plants", p] as const,
  plant: (id: number) => ["plant", id] as const,
  history: (id: number) => ["history", id] as const,
  legacy: (id: number) => ["legacy", id] as const,
  zones: ["zones"] as const,
  equipment: (p: EquipmentQuery) => ["equipment", p] as const,
  equipmentKinds: ["equipment-kinds"] as const,
  documents: (plantId: number, p: { category?: string; q?: string }) => ["documents", plantId, p] as const,
  documentCategories: ["document-categories"] as const,
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

// ===================================================================== equipment search

/** Which equipment lists exist, and what "type" means in each. Effectively static. */
export function useEquipmentKinds() {
  return useQuery({
    queryKey: keys.equipmentKinds,
    queryFn: () => api<{ items: EquipmentKind[] }>("equipment/kinds"),
    staleTime: Infinity,
  })
}

/**
 * Cross-plant equipment search. One request returns the totals, the per-zone
 * breakdown, the matching plants and the Make / Model / Type options, all from
 * one database snapshot, so the numbers on screen always agree with each other.
 */
export function useEquipmentSearch(params: EquipmentQuery, enabled = true) {
  return useQuery({
    queryKey: keys.equipment(params),
    queryFn: ({ signal }) => api<EquipmentSearchResult>("equipment/search", { params, signal }),
    placeholderData: keepPreviousData,
    enabled,
  })
}

// ===================================================================== documents

export function useDocumentCategories() {
  return useQuery({
    queryKey: keys.documentCategories,
    queryFn: () => api<DocumentCategoryInfo>("document-categories"),
    staleTime: Infinity,
  })
}

export function usePlantDocuments(plantId: number, params: { category?: string; q?: string } = {}) {
  return useQuery({
    queryKey: keys.documents(plantId, params),
    queryFn: ({ signal }) => api<PlantDocumentList>(`plants/${plantId}/documents`, { params, signal }),
    placeholderData: keepPreviousData,
  })
}

export interface UploadRequest {
  file: File
  category: string
  title: string
  description?: string | null
  /** Overwrite the document with the same category and file name, keeping its id. */
  replace?: boolean
  reason?: string | null
}

/**
 * Uploads, edits and deletions in a plant's document library. Each one refreshes
 * the library, the plant (its document count) and the plant's history.
 */
export function usePlantDocumentWrite(plantId: number) {
  const qc = useQueryClient()
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["documents", plantId] }),
      qc.invalidateQueries({ queryKey: keys.plant(plantId) }),
      qc.invalidateQueries({ queryKey: keys.history(plantId) }),
      qc.invalidateQueries({ queryKey: ["plants"] }),
    ])
  }

  const upload = useMutation({
    mutationFn: (req: UploadRequest) => {
      const form = new FormData()
      form.set("file", req.file, req.file.name)
      form.set("category", req.category)
      form.set("title", req.title)
      if (req.description) form.set("description", req.description)
      if (req.replace) form.set("replace", "true")
      return api<unknown>(`plants/${plantId}/documents`, { method: "POST", body: form, reason: req.reason })
    },
    onSuccess: () => toast.success("Document uploaded"),
    onError: (e) => toast.error("Upload failed", { description: errorMessage(e) }),
    onSettled: refresh,
  })

  const write = useMutation({
    mutationFn: (req: WriteRequest) =>
      api<unknown>(req.path, { method: req.method, body: req.body, reason: req.reason }),
    onSuccess: (_d, req) => {
      if (req.success) toast.success(req.success)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isConflict) {
        toast.error("Someone else changed this document", {
          description: `${errorMessage(e)} The latest details have been loaded.`,
        })
      } else {
        toast.error("Change not saved", { description: errorMessage(e) })
      }
    },
    onSettled: refresh,
  })

  return { upload, write }
}
