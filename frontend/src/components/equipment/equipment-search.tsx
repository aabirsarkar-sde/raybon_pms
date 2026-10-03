"use client"

import { ChevronLeft, ChevronRight, Loader2, PackageSearch, Search, SearchX, X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { ActiveFilters, FacetSelect } from "@/components/common/facet-select"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDebounced } from "@/hooks/use-debounced"
import { useEquipmentKinds, useEquipmentSearch, type EquipmentQuery } from "@/lib/api/hooks"
import type { EquipmentKind, EquipmentKindKey, FacetDimension } from "@/lib/api/types"
import { KIND_ICON, KIND_ORDER } from "@/lib/equipment"
import { cn } from "@/lib/utils"

import { EquipmentResults } from "./equipment-results"
import { ZoneBreakdown } from "./zone-breakdown"

const PAGE_SIZES = [25, 50, 100]
const SORTS = [
  { value: "items", label: "Most matches" },
  { value: "name", label: "Plant name (A–Z)" },
  { value: "zone", label: "Zone" },
  { value: "legacy_plant_id", label: "Legacy ID" },
]
const FACET_LABELS: Record<FacetDimension, string> = { make: "Make", model: "Model", type: "Type" }

/** One headline number. */
function Stat({ name, value, label, hint }: { name: string; value: number; label: string; hint?: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border bg-card px-3 py-2.5">
      <div className="text-2xl leading-none font-semibold tabular" data-testid={`stat-${name}`}>
        {value.toLocaleString()}
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground" title={hint}>
        {label}
      </div>
    </div>
  )
}

/**
 * Cross-plant equipment search.
 *
 * Answers "how many plants have this?" — type a model such as CRN 10-15 and the
 * page reports the matches, the plants and the zones they are in; narrow by zone,
 * make, model, type or equipment list and every number follows.
 *
 * All filter state lives in the URL, so a result worth reporting can be sent to
 * someone as a link.
 */
export function EquipmentSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const kindsQuery = useEquipmentKinds()

  const [text, setText] = useState(sp.get("q") ?? "")
  const debounced = useDebounced(text.trim(), 300)

  // Multi-value filters live in repeated query parameters (?zone_id=1&zone_id=4).
  // They are keyed as JSON so the arrays below keep a stable identity between
  // renders — a value containing a separator character would survive it too.
  const makeKey = JSON.stringify(sp.getAll("make"))
  const modelKey = JSON.stringify(sp.getAll("model"))
  const typeKey = JSON.stringify(sp.getAll("type"))
  const kindKey = JSON.stringify(sp.getAll("kind"))
  const zoneKey = JSON.stringify(sp.getAll("zone_id").map(Number).filter(Number.isFinite))
  const makes = useMemo<string[]>(() => JSON.parse(makeKey), [makeKey])
  const models = useMemo<string[]>(() => JSON.parse(modelKey), [modelKey])
  const types = useMemo<string[]>(() => JSON.parse(typeKey), [typeKey])
  const kinds = useMemo<string[]>(() => JSON.parse(kindKey), [kindKey])
  const zoneIds = useMemo<number[]>(() => JSON.parse(zoneKey), [zoneKey])
  const unzoned = sp.get("unzoned") === "true"
  const sort = SORTS.some((s) => s.value === sp.get("sort")) ? sp.get("sort")! : "items"
  const size = PAGE_SIZES.includes(Number(sp.get("size"))) ? Number(sp.get("size")) : 25
  const page = Math.max(1, Number(sp.get("page")) || 1)

  const update = useCallback(
    (changes: Record<string, string | string[] | null>, resetPage = true) => {
      const next = new URLSearchParams(sp)
      for (const [k, v] of Object.entries(changes)) {
        next.delete(k)
        if (Array.isArray(v)) v.forEach((item) => next.append(k, item))
        else if (v !== null && v !== "") next.set(k, v)
      }
      if (resetPage) next.delete("page")
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false })
    },
    [sp, pathname, router],
  )

  // Keep the URL in step with the (debounced) search box.
  useEffect(() => {
    if ((sp.get("q") ?? "") !== debounced) update({ q: debounced || null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])

  const params: EquipmentQuery = useMemo(
    () => ({
      q: debounced || undefined,
      kind: kinds.length ? kinds : undefined,
      make: makes.length ? makes : undefined,
      model: models.length ? models : undefined,
      type: types.length ? types : undefined,
      zone_id: zoneIds.length ? zoneIds : undefined,
      unzoned: unzoned || undefined,
      sort,
      limit: size,
      offset: (page - 1) * size,
      matches: 25,
    }),
    [debounced, kinds, makes, models, types, zoneIds, unzoned, sort, size, page],
  )

  const { data, isLoading, isError, error, refetch, isFetching } = useEquipmentSearch(params)

  const kindByKey = useMemo(() => {
    const source: EquipmentKind[] = kindsQuery.data?.items ?? data?.kinds ?? []
    return Object.fromEntries(source.map((k) => [k.kind, k])) as Record<string, EquipmentKind>
  }, [kindsQuery.data, data?.kinds])

  const anyFilter = Boolean(
    debounced || kinds.length || makes.length || models.length || types.length || zoneIds.length || unzoned,
  )
  const pages = data ? Math.max(1, Math.ceil(data.plants.total / size)) : 1

  function clearAll() {
    setText("")
    router.replace(pathname)
  }

  function toggleZone(zoneId: number) {
    const next = zoneIds.includes(zoneId)
      ? zoneIds.filter((z) => z !== zoneId)
      : [...zoneIds, zoneId]
    update({ zone_id: next.map(String) })
  }

  function toggleKind(key: EquipmentKindKey) {
    const next = kinds.includes(key) ? kinds.filter((k) => k !== key) : [...kinds, key]
    update({ kind: next })
  }

  const kindCounts = useMemo(
    () => Object.fromEntries((data?.kinds ?? []).map((k) => [k.kind, k.items])),
    [data?.kinds],
  )

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <PageHeader
        title="Equipment search"
        description="Find a make, model or type across every plant and zone, and see how many sites have it."
      />

      {/* ---- search box and facet filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Model, make or name — e.g. CRN 10-15, Grundfos, Feed Flow Trans."
              className="pr-8 pl-8"
              aria-label="Search equipment"
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
          {(["make", "model", "type"] as FacetDimension[]).map((dim) => (
            <FacetSelect
              key={dim}
              label={FACET_LABELS[dim]}
              options={(data?.facets[dim] ?? []).map((f) => ({
                value: f.value,
                count: f.items,
                secondary: f.plants,
                spellings: f.spellings,
              }))}
              selected={dim === "make" ? makes : dim === "model" ? models : types}
              onChange={(next) => update({ [dim]: next })}
              truncated={data?.facets_truncated.includes(dim)}
              countLabel="rows / plants"
              emptyText={isLoading ? "Loading…" : "Nothing matches the other filters"}
              className="w-auto min-w-36 flex-1 sm:flex-none"
            />
          ))}
          <Select value={sort} onValueChange={(v) => update({ sort: v === "items" ? null : v })}>
            <SelectTrigger className="w-44" aria-label="Sort plants by">
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
        </div>

        {/* ---- equipment list chips, with live counts */}
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            aria-pressed={kinds.length === 0}
            onClick={() => update({ kind: [] })}
            className={cn(
              "shrink-0 rounded-md border px-2.5 py-1 text-xs",
              kinds.length === 0 ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted",
            )}
          >
            All equipment
          </button>
          {KIND_ORDER.map((key) => {
            const Icon = KIND_ICON[key]
            const n = kindCounts[key] ?? 0
            const active = kinds.includes(key)
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleKind(key)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs",
                  active ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted",
                  !active && n === 0 && "text-muted-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {kindByKey[key]?.label ?? key}
                <span className="tabular">{n}</span>
              </button>
            )
          })}
        </div>

        <ActiveFilters
          groups={[
            { label: "Make", values: makes, onRemove: (v) => update({ make: makes.filter((m) => m !== v) }) },
            { label: "Model", values: models, onRemove: (v) => update({ model: models.filter((m) => m !== v) }) },
            { label: "Type", values: types, onRemove: (v) => update({ type: types.filter((t) => t !== v) }) },
            {
              label: "Zone",
              values: zoneIds.map(
                (id) => data?.zones.find((z) => z.zone.id === id)?.zone.name ?? `Zone ${id}`,
              ),
              onRemove: (name) => {
                const id = data?.zones.find((z) => z.zone.name === name)?.zone.id
                if (id !== undefined) toggleZone(id)
              },
            },
          ]}
          onClearAll={clearAll}
        />
      </div>

      {isError ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : !anyFilter && !data ? (
        <TableSkeleton rows={6} cols={4} />
      ) : (
        <>
          {/* ---- headline numbers */}
          <div className="flex flex-wrap gap-2">
            <Stat
              name="items"
              value={data?.summary.items ?? 0}
              label="matching items"
              hint="Equipment rows that match every filter"
            />
            <Stat
              name="plants"
              value={data?.summary.plants ?? 0}
              label="plants / sites"
              hint="Plants that have at least one match"
            />
            <Stat name="zones" value={data?.summary.zones ?? 0} label="zones" hint="Zones those plants are in" />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            {data && (
              <ZoneBreakdown
                zones={data.zones}
                unzoned={data.unzoned}
                selected={zoneIds}
                onToggle={toggleZone}
                includeUnzoned={unzoned}
                onToggleUnzoned={() => update({ unzoned: unzoned ? null : "true" })}
              />
            )}

            <section className="min-w-0 overflow-hidden rounded-lg border bg-card" aria-labelledby="results-heading">
              <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-3 py-2">
                <h2 id="results-heading" className="flex items-center gap-1.5 text-sm font-medium">
                  <PackageSearch className="size-4 text-muted-foreground" /> Plants
                  {data && (
                    <Badge variant="secondary" className="tabular">
                      {data.plants.total}
                    </Badge>
                  )}
                </h2>
                {data && data.plants.total > 0 && (
                  <p className="text-xs text-muted-foreground tabular">
                    {data.plants.offset + 1}–{data.plants.offset + data.plants.items.length} of{" "}
                    {data.plants.total}
                  </p>
                )}
              </header>

              {isLoading ? (
                <TableSkeleton rows={8} cols={3} />
              ) : !data || data.plants.items.length === 0 ? (
                <EmptyState
                  icon={SearchX}
                  title={anyFilter ? "No equipment matches" : "Search for a make, model or type"}
                  message={
                    anyFilter
                      ? "Try a shorter search, a different equipment list, or clear a filter. Values are matched exactly as they are stored, including spellings such as “GRUNDFOSE”."
                      : "Type a model number such as CRN 10-15 to see every plant that has it, or pick an equipment list below to browse what exists."
                  }
                  action={
                    anyFilter && (
                      <Button variant="outline" size="sm" onClick={clearAll}>
                        Clear filters
                      </Button>
                    )
                  }
                />
              ) : (
                <div className={cn(isFetching && "opacity-70 transition-opacity")}>
                  <EquipmentResults groups={data.plants.items} kinds={kindByKey} />
                </div>
              )}

              {data && data.plants.total > size && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-sm text-muted-foreground">
                  <Select value={String(size)} onValueChange={(v) => update({ size: v === "25" ? null : v })}>
                    <SelectTrigger size="sm" className="w-28" aria-label="Plants per page">
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
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      disabled={page <= 1}
                      onClick={() => update({ page: String(page - 1) }, false)}
                      aria-label="Previous page"
                    >
                      <ChevronLeft />
                    </Button>
                    <Badge variant="outline" className="tabular">
                      {page} / {pages}
                    </Badge>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      disabled={page >= pages}
                      onClick={() => update({ page: String(page + 1) }, false)}
                      aria-label="Next page"
                    >
                      <ChevronRight />
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
