"use client"

import { ChevronRight, ExternalLink } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { ValueText } from "@/components/common/value"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { EquipmentKind, EquipmentMatch, EquipmentPlantGroup } from "@/lib/api/types"
import { describeDetail, KIND_ICON } from "@/lib/equipment"
import { cn } from "@/lib/utils"

/** One matching row: what it is, who made it, which model, plus any extra values. */
function MatchRow({ match, kinds }: { match: EquipmentMatch; kinds: Record<string, EquipmentKind> }) {
  const kind = kinds[match.kind]
  const Icon = KIND_ICON[match.kind]
  const extra = describeDetail(match)
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1 text-sm">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="size-3.5 shrink-0" />}
        <span className="w-28 shrink-0 truncate" title={kind?.label}>
          {kind?.label ?? match.kind}
        </span>
      </span>
      <span className="min-w-0 font-medium">
        <ValueText value={match.type} />
      </span>
      {match.make && (
        <span className="text-muted-foreground">
          · <ValueText value={match.make} />
        </span>
      )}
      {match.model && (
        <span className="font-mono text-xs">
          · <ValueText value={match.model} mono />
        </span>
      )}
      {extra.map((e) => (
        <span key={e.label} className="text-xs text-muted-foreground">
          · {e.label} <span className="font-mono text-foreground/80">{e.value}</span>
        </span>
      ))}
    </li>
  )
}

function PlantGroup({
  group,
  kinds,
  defaultOpen,
}: {
  group: EquipmentPlantGroup
  kinds: Record<string, EquipmentKind>
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const p = group.plant
  const hidden = group.items - group.matches.length
  // One link per section the matches came from, so "where in the plant" is one click.
  const sections = [
    ...new Map(
      group.matches
        .map((m) => kinds[m.kind])
        .filter((k): k is EquipmentKind => Boolean(k))
        .map((k) => [k.slug, k.label] as const),
    ),
  ]

  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-start gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Hide matches in ${p.display_name ?? p.name}` : `Show matches in ${p.display_name ?? p.name}`}
          onClick={() => setOpen((o) => !o)}
          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Link href={`/plants/${p.id}`} className="font-medium hover:underline">
              {p.display_name ?? p.name}
            </Link>
            <Badge variant="secondary" className="tabular">
              {group.items} match{group.items === 1 ? "" : "es"}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{p.zone ? p.zone.name : "No zone"}</span>
            <span className="font-mono">
              S/N <ValueText value={p.serial_number} />
            </span>
            <span>
              <ValueText value={p.capacity} />
            </span>
            {p.legacy_plant_id !== null && <span className="font-mono">Legacy #{p.legacy_plant_id}</span>}
          </div>
          {open && (
            <>
              <ul className="mt-1.5 divide-y border-t pt-1">
                {group.matches.map((m) => (
                  <MatchRow key={`${m.kind}-${m.id}`} match={m} kinds={kinds} />
                ))}
              </ul>
              {hidden > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  and {hidden} more in this plant —{" "}
                  <Link href={`/plants/${p.id}`} className="underline">
                    open the plant
                  </Link>{" "}
                  to see them all.
                </p>
              )}
              {sections.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {sections.map(([slug, label]) => (
                    <Button key={slug} asChild variant="ghost" size="sm" className="h-6 text-xs">
                      <Link href={`/plants/${p.id}#${slug}`}>
                        <ExternalLink className="size-3" /> {label}
                      </Link>
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  )
}

export function EquipmentResults({
  groups,
  kinds,
}: {
  groups: EquipmentPlantGroup[]
  kinds: Record<string, EquipmentKind>
}) {
  // A short list is expanded for you; a long one stays scannable.
  const defaultOpen = groups.length <= 10
  return (
    <ul className="divide-y">
      {groups.map((g) => (
        <PlantGroup key={g.plant.id} group={g} kinds={kinds} defaultOpen={defaultOpen} />
      ))}
    </ul>
  )
}
