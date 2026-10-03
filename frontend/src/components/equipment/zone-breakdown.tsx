"use client"

import { MapPin } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { ZoneCount } from "@/lib/api/types"
import { cn } from "@/lib/utils"

/**
 * How the matches are spread across zones, and the control for narrowing to one,
 * two or several of them.
 *
 * The counts deliberately ignore the zone selection: after picking Vadodara you
 * can still see what Ankleshwar and Jhagadia hold, which is the whole point of
 * asking the question by zone. Only the totals above and the plant list below
 * follow the selection.
 */
export function ZoneBreakdown({
  zones,
  unzoned,
  selected,
  onToggle,
  includeUnzoned,
  onToggleUnzoned,
}: {
  zones: ZoneCount[]
  unzoned: { items: number; plants: number }
  selected: number[]
  onToggle: (zoneId: number) => void
  includeUnzoned: boolean
  onToggleUnzoned: () => void
}) {
  const max = Math.max(1, ...zones.map((z) => z.items), unzoned.items)
  const chosen = new Set(selected)
  const anyChosen = chosen.size > 0 || includeUnzoned

  const rows: {
    key: string
    name: string
    items: number
    plants: number
    active: boolean
    onClick: () => void
  }[] = [
    ...zones.map((z) => ({
      key: `z${z.zone.id}`,
      name: z.zone.name,
      items: z.items,
      plants: z.plants,
      active: chosen.has(z.zone.id),
      onClick: () => onToggle(z.zone.id),
    })),
    ...(unzoned.items > 0
      ? [
          {
            key: "unzoned",
            name: "No zone recorded",
            items: unzoned.items,
            plants: unzoned.plants,
            active: includeUnzoned,
            onClick: onToggleUnzoned,
          },
        ]
      : []),
  ]

  return (
    <section className="rounded-lg border bg-card" aria-labelledby="zone-breakdown-heading">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-3 py-2">
        <h2 id="zone-breakdown-heading" className="flex items-center gap-1.5 text-sm font-medium">
          <MapPin className="size-4 text-muted-foreground" /> By zone
        </h2>
        <p className="text-xs text-muted-foreground">
          {anyChosen
            ? "Counts cover every zone, so they stay comparable while filtered."
            : "Select zones to narrow the results."}
        </p>
      </header>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              aria-pressed={r.active}
              data-testid={`zone-row-${r.name}`}
              onClick={r.onClick}
              disabled={r.items === 0 && !r.active}
              className={cn(
                "group flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                "hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-45",
                r.active && "bg-primary/5",
              )}
            >
              <span
                className={cn(
                  "size-3.5 shrink-0 rounded-sm border",
                  r.active ? "border-primary bg-primary" : "border-input group-hover:border-primary/50",
                )}
                aria-hidden
              />
              <span className={cn("min-w-0 flex-1 truncate", r.active && "font-medium")}>{r.name}</span>
              {/* Proportional bar: the shape of the distribution at a glance. */}
              <span className="hidden h-2 w-28 shrink-0 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
                <span
                  className={cn("block h-full rounded-full", r.active ? "bg-primary" : "bg-primary/35")}
                  style={{ width: `${Math.round((r.items / max) * 100)}%` }}
                />
              </span>
              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular">
                {r.plants} plant{r.plants === 1 ? "" : "s"}
              </span>
              <Badge
                variant={r.items === 0 ? "outline" : "secondary"}
                className="w-12 justify-center tabular"
                data-testid={`zone-items-${r.name}`}
              >
                {r.items}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
