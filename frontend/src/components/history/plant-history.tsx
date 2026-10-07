"use client"

import { ArrowRight, ArrowUpDown, FileClock, Loader2, Minus, Plus, Quote } from "lucide-react"
import { useMemo, useState } from "react"

import { EmptyState, ErrorState, TableSkeleton } from "@/components/common/states"
import { ValueText } from "@/components/common/value"
import { usePlantCtx } from "@/components/plant/plant-context"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useHistory, useZones } from "@/lib/api/hooks"
import type { Json } from "@/lib/api/types"
import { formatDateTime, formatRelative, initials } from "@/lib/values"

import { describe, type Change } from "./describe"

function Val({ v }: { v: Json }) {
  return (
    <span className="rounded bg-muted px-1 py-px font-medium">
      <ValueText value={typeof v === "object" && v !== null ? JSON.stringify(v) : v} />
    </span>
  )
}

function ChangeLine({ c }: { c: Change }) {
  if (c.kind === "update")
    return (
      <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span className="text-muted-foreground">
          {c.area.title}
          {c.area.key !== "plant" && (
            <>
              {" "}
              › <span className="text-foreground">{c.row}</span>
            </>
          )}
          {" · "}
          <span className="font-medium text-foreground">{c.field}</span>
        </span>
        {/* A long unbroken value (a file checksum, a part number) must wrap inside
            the row instead of widening the page: min-w-0 lets the flex item shrink. */}
        <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5 [overflow-wrap:anywhere]">
          <span className="line-through decoration-muted-foreground/60">
            <Val v={c.old} />
          </span>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
          <Val v={c.new} />
        </span>
      </li>
    )
  if (c.kind === "reorder")
    return (
      <li className="flex items-center gap-1.5">
        <ArrowUpDown className="size-3.5 text-muted-foreground" />
        <span>
          Reordered {c.area.title}
          {c.row && <> › {c.row}</>} <span className="text-muted-foreground">({c.count} rows moved)</span>
        </span>
      </li>
    )
  const add = c.kind === "insert"
  return (
    <li className="space-y-1">
      <div className="flex items-center gap-1.5">
        {add ? <Plus className="size-3.5 text-added" /> : <Minus className="size-3.5 text-destructive" />}
        <span>
          {add ? "Added" : "Removed"} {c.area.noun} in {c.area.title}: <span className="font-medium">{c.row}</span>
        </span>
      </div>
      {c.values.length > 0 && (
        <dl className="ml-5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {c.values.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="inline">{k}: </dt>
              <dd className="inline text-foreground/80 [overflow-wrap:anywhere]">
                <ValueText value={v} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}

export function PlantHistory() {
  const { plant } = usePlantCtx()
  const { data, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useHistory(plant.id)
  const zones = useZones()
  const [area, setArea] = useState("all")
  const [who, setWho] = useState("all")

  const entries = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])
  const sets = useMemo(() => describe(plant, entries, zones.data?.items), [plant, entries, zones.data])
  const people = [...new Set(sets.map((s) => s.who ?? "Unknown"))]
  const areaNames = [...new Set(sets.flatMap((s) => s.areas))]
  const visible = sets.filter((s) => (area === "all" || s.areas.includes(area)) && (who === "all" || (s.who ?? "Unknown") === who))
  const total = data?.pages[0]?.total ?? 0

  if (isLoading) return <TableSkeleton rows={6} cols={3} />
  if (isError) return <ErrorState message={error.message} onRetry={() => refetch()} />
  if (sets.length === 0)
    return (
      <EmptyState
        icon={FileClock}
        title="No changes yet"
        message={
          plant.origin === "legacy"
            ? "This plant is exactly as imported from the legacy system."
            : "Edits to this plant will appear here."
        }
      />
    )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {sets.length} change{sets.length === 1 ? "" : "s"} · most recent first
        </p>
        <Select value={area} onValueChange={setArea}>
          <SelectTrigger className="w-48" aria-label="Filter by section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sections</SelectItem>
            {areaNames.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={who} onValueChange={setWho}>
          <SelectTrigger className="w-44" aria-label="Filter by person">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            {people.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ol className="relative space-y-3 before:absolute before:top-2 before:bottom-2 before:left-4 before:w-px before:bg-border">
        {visible.map((s) => (
          <li key={s.key} className="relative flex gap-3" data-testid="change-set">
            <Avatar className="z-10 size-8 ring-4 ring-background">
              <AvatarFallback className="bg-accent text-xs text-accent-foreground">{initials(s.who ?? "?")}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="font-medium">{s.who ?? "Unknown user"}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <time dateTime={s.at} className="text-muted-foreground">
                      {formatRelative(s.at)}
                    </time>
                  </TooltipTrigger>
                  <TooltipContent>{formatDateTime(s.at)}</TooltipContent>
                </Tooltip>
                <span className="ml-auto flex flex-wrap gap-1">
                  {s.areas.map((a) => (
                    <Badge key={a} variant="secondary" className="font-normal">
                      {a}
                    </Badge>
                  ))}
                </span>
              </div>
              {s.reason ? (
                <p className="mt-1.5 flex items-start gap-1.5 text-sm text-muted-foreground italic">
                  <Quote className="mt-0.5 size-3.5 shrink-0" /> {s.reason}
                </p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground/70">No reason given</p>
              )}
              <ul className="mt-2 space-y-1.5 border-t pt-2 text-sm">
                {s.changes.map((c, i) => (
                  <ChangeLine key={i} c={c} />
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
      {visible.length === 0 && <p className="text-sm text-muted-foreground">No changes match these filters.</p>}
      {hasNextPage && (
        <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage && <Loader2 className="animate-spin" />} Load older changes ({entries.length} of {total} log entries loaded)
        </Button>
      )}
    </div>
  )
}
