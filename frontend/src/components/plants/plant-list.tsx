"use client"

import { ChevronLeft, ChevronRight, Loader2, Search, SearchX, X } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"

import { OriginBadge, ValueText } from "@/components/common/value"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDebounced } from "@/hooks/use-debounced"
import { usePlants, useZones, type PlantSearch } from "@/lib/api/hooks"
import type { PlantListItem } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { COUNTER_ORDER, SECTION_BY_KEY } from "@/lib/sections"
import { cn } from "@/lib/utils"

import { CreatePlantSheet } from "./create-plant-sheet"

const PAGE_SIZES = [25, 50, 100]
const SORTS = [
  { value: "legacy_plant_id", label: "Legacy ID" },
  { value: "name", label: "Name (A–Z)" },
  { value: "serial_number", label: "Serial number" },
  { value: "zone", label: "Zone" },
]

function EquipmentCounts({ p }: { p: PlantListItem }) {
  return (
    <div className="flex flex-wrap gap-1">
      {COUNTER_ORDER.map((k) => {
        const s = SECTION_BY_KEY[k]
        const n = p.counts[k]
        return (
          <Tooltip key={k}>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "inline-flex h-5 items-center gap-0.5 rounded border px-1 text-[11px] tabular",
                  n === 0 ? "border-dashed text-muted-foreground/50" : "bg-muted/50 text-foreground/80",
                )}
              >
                <s.icon className="size-3" />
                {n}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {s.title}: {n}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

export function PlantList() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const { can } = useSession()
  const zones = useZones()

  const scope = sp.get("scope") === "serial" ? "serial" : "all"
  const [text, setText] = useState(sp.get("q") ?? "")
  const debounced = useDebounced(text.trim(), 300)
  const zoneId = sp.get("zone_id")
  const modified = sp.get("modified")
  const origin = sp.get("origin")
  const sort = sp.get("sort") ?? "legacy_plant_id"
  const size = PAGE_SIZES.includes(Number(sp.get("size"))) ? Number(sp.get("size")) : 50
  const page = Math.max(1, Number(sp.get("page")) || 1)

  function update(changes: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k)
      else next.set(k, v)
    }
    if (resetPage) next.delete("page")
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false })
  }

  // Keep the URL in sync with the (debounced) search box.
  useEffect(() => {
    if ((sp.get("q") ?? "") !== debounced) update({ q: debounced || null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const params: PlantSearch = {
    ...(scope === "serial" ? { serial_number: debounced || undefined } : { q: debounced || undefined }),
    zone_id: zoneId ? Number(zoneId) : undefined,
    modified: modified === "true" ? true : undefined,
    origin: origin === "app" || origin === "legacy" ? origin : undefined,
    sort,
    limit: size,
    offset: (page - 1) * size,
  }
  const { data, isLoading, isError, error, refetch, isFetching } = usePlants(params)
  const pages = data ? Math.max(1, Math.ceil(data.total / size)) : 1
  const filtered = Boolean(debounced || zoneId || modified || origin)

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader title="Plants" description={data ? `${data.total} plant${data.total === 1 ? "" : "s"}${filtered ? " match your filters" : ""}` : "Loading…"}>
        {can("admin") && <CreatePlantSheet />}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={scope}
          onValueChange={(v) => v && update({ scope: v === "serial" ? "serial" : null })}
          aria-label="Search in"
        >
          <ToggleGroupItem value="all">Name or serial</ToggleGroupItem>
          <ToggleGroupItem value="serial">Serial no. (exact)</ToggleGroupItem>
        </ToggleGroup>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={scope === "serial" ? "Exact serial number, e.g. 2094" : "Search plant name, display name or serial…"}
            className="pr-8 pl-8"
            aria-label="Search plants"
          />
          {isFetching && !isLoading ? (
            <Loader2 className="absolute top-1/2 right-2.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : text ? (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => setText("")}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        <Select value={zoneId ?? "all"} onValueChange={(v) => update({ zone_id: v === "all" ? null : v })}>
          <SelectTrigger className="w-40" aria-label="Zone">
            <SelectValue placeholder="Zone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All zones</SelectItem>
            {zones.data?.items.map((z) => (
              <SelectItem key={z.id} value={String(z.id)}>
                {z.name} ({z.plant_count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={modified === "true" ? "edited" : origin === "app" ? "app" : origin === "legacy" ? "legacy" : "all"}
          onValueChange={(v) =>
            update({ modified: v === "edited" ? "true" : null, origin: v === "app" || v === "legacy" ? v : null })
          }
        >
          <SelectTrigger className="w-44" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All plants</SelectItem>
            <SelectItem value="edited">Edited since import</SelectItem>
            <SelectItem value="legacy">From legacy system</SelectItem>
            <SelectItem value="app">Added in new system</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => update({ sort: v === "legacy_plant_id" ? null : v })}>
          <SelectTrigger className="w-40" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                Sort: {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText("")
              router.replace(pathname)
            }}
          >
            <X /> Clear
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {isLoading ? (
          <TableSkeleton rows={10} cols={6} />
        ) : isError ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : data && data.items.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No plants found"
            message={scope === "serial" ? "Serial search matches the exact serial number. Try “Name or serial” for partial matches." : "Try a different search or clear the filters."}
            action={
              filtered && (
                <Button variant="outline" size="sm" onClick={() => { setText(""); router.replace(pathname) }}>
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-20">Legacy ID</TableHead>
                  <TableHead>Plant</TableHead>
                  <TableHead>Serial no.</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Equipment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className={cn(isFetching && "opacity-70 transition-opacity")}>
                {data?.items.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/plants/${p.id}`)}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.legacy_plant_id ?? "—"}</TableCell>
                    <TableCell className="max-w-md">
                      <Link href={`/plants/${p.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {p.display_name ?? p.name}
                      </Link>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate">{p.name}</span>
                        <OriginBadge origin={p.origin} modified={p.has_changes} />
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      <ValueText value={p.serial_number} />
                    </TableCell>
                    <TableCell>
                      <ValueText value={p.capacity} />
                    </TableCell>
                    <TableCell>{p.zone ? p.zone.name : <ValueText value={null} />}</TableCell>
                    <TableCell>
                      <EquipmentCounts p={p} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {/* Mobile list */}
            <ul className="divide-y md:hidden">
              {data?.items.map((p) => (
                <li key={p.id}>
                  <Link href={`/plants/${p.id}`} className="block space-y-1.5 p-3 active:bg-muted">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 font-medium">{p.display_name ?? p.name}</span>
                      <OriginBadge origin={p.origin} modified={p.has_changes} />
                    </div>
                    <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span className="font-mono">#{p.serial_number ?? "—"}</span>
                      <span>{p.capacity ?? "—"}</span>
                      <span>{p.zone?.name ?? "No zone"}</span>
                    </div>
                    <EquipmentCounts p={p} />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {data.offset + 1}–{data.offset + data.items.length} of {data.total}
          </span>
          <div className="flex items-center gap-2">
            <Select value={String(size)} onValueChange={(v) => update({ size: v === "50" ? null : v })}>
              <SelectTrigger size="sm" className="w-28" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} / page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <Badge variant="outline" className="tabular">
              {page} / {pages}
            </Badge>
            <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => update({ page: String(page + 1) }, false)} aria-label="Next page">
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

