"use client"

import { ArrowRight, Factory, FilePlus2, MapPin, PencilLine, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"

import { ErrorState } from "@/components/common/states"
import { PageHeader } from "@/components/common/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useRecentPlants } from "@/hooks/use-recent-plants"
import { usePlants, useZones } from "@/lib/api/hooks"
import type { PlantListItem, SectionKey } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { COUNTER_ORDER, SECTION_BY_KEY } from "@/lib/sections"

function Stat({
  label,
  value,
  icon: Icon,
  href,
  hint,
}: {
  label: string
  value: number | undefined
  icon: React.ComponentType<{ className?: string }>
  href?: string
  hint?: string
}) {
  const body = (
    <Card className="gap-1 py-4 transition-colors hover:border-primary/40">
      <CardContent className="flex items-start justify-between px-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase">{label}</p>
          <div className="mt-1 text-2xl font-semibold tabular">{value ?? <Skeleton className="h-7 w-12" />}</div>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <Icon className="size-5 text-muted-foreground" />
      </CardContent>
    </Card>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

export function Dashboard() {
  const { user } = useSession()
  const all = usePlants({ limit: 500 })
  const edited = usePlants({ modified: true, limit: 8 })
  const added = usePlants({ origin: "app", limit: 1 })
  const zones = useZones()
  const { items: recent } = useRecentPlants()

  const totals = useMemo(() => {
    const t = {} as Record<SectionKey, number>
    for (const p of all.data?.items ?? []) for (const k of COUNTER_ORDER) t[k] = (t[k] ?? 0) + p.counts[k]
    return t
  }, [all.data])

  /** Serial numbers used by more than one plant. Shown, never merged. */
  const sharedSerials = useMemo(() => {
    const by = new Map<string, PlantListItem[]>()
    for (const p of all.data?.items ?? []) {
      if (!p.serial_number) continue
      by.set(p.serial_number, [...(by.get(p.serial_number) ?? []), p])
    }
    return [...by.entries()].filter(([, ps]) => ps.length > 1)
  }, [all.data])

  if (all.isError) return <ErrorState message={all.error.message} onRetry={() => all.refetch()} />

  const maxZone = Math.max(1, ...(zones.data?.items.map((z) => z.plant_count) ?? [1]))

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <PageHeader title={`Welcome, ${user.display_name ?? user.name}`} description="Overview of all plants in the Plant Data Management System.">
        <Button asChild>
          <Link href="/plants">
            Browse plants <ArrowRight />
          </Link>
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Plants" value={all.data?.total} icon={Factory} href="/plants" />
        <Stat label="Zones" value={zones.data?.items.length} icon={MapPin} />
        <Stat label="Plants with edits" value={edited.data?.total} icon={PencilLine} href="/plants?modified=true" hint="Changed since legacy import" />
        <Stat label="Added in new system" value={added.data?.total} icon={FilePlus2} href="/plants?origin=app" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Equipment across all plants</CardTitle>
            <CardDescription>Row counts per section, summed over every plant.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              {COUNTER_ORDER.map((k) => {
                const s = SECTION_BY_KEY[k]
                return (
                  <div key={k} className="flex items-center gap-2.5">
                    <s.icon className="size-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <dt className="truncate text-xs text-muted-foreground">{s.title}</dt>
                      <dd className="font-semibold tabular">{all.data ? (totals[k] ?? 0).toLocaleString() : <Skeleton className="h-5 w-10" />}</dd>
                    </div>
                  </div>
                )
              })}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plants by zone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {zones.isLoading && <Skeleton className="h-32" />}
            {zones.data?.items.map((z) => (
              <Link key={z.id} href={`/plants?zone_id=${z.id}`} className="group block">
                <div className="flex justify-between text-sm">
                  <span className="group-hover:underline">{z.name}</span>
                  <span className="text-muted-foreground tabular">{z.plant_count}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${(z.plant_count / maxZone) * 100}%` }} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Recently viewed</CardTitle>
            <CardDescription>On this device.</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Plants you open will appear here.</p>
            ) : (
              <ul className="divide-y text-sm">
                {recent.map((p) => (
                  <li key={p.id}>
                    <Link href={`/plants/${p.id}`} className="flex items-center gap-2 py-2 hover:text-primary">
                      <span className="truncate">{p.label}</span>
                      {p.serial && <span className="ml-auto font-mono text-xs text-muted-foreground">{p.serial}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plants with edits</CardTitle>
            <CardDescription>Plants whose data has changed since the legacy import.</CardDescription>
          </CardHeader>
          <CardContent>
            {edited.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No plant has been edited yet.</p>}
            <ul className="divide-y text-sm">
              {edited.data?.items.map((p) => (
                <li key={p.id}>
                  <Link href={`/plants/${p.id}/history`} className="flex items-center gap-2 py-2 hover:text-primary">
                    <span className="truncate">{p.display_name ?? p.name}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{p.serial_number}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {(edited.data?.total ?? 0) > 8 && (
              <Button variant="link" className="px-0" asChild>
                <Link href="/plants?modified=true">View all {edited.data?.total}</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="size-4 text-modified" /> Shared serial numbers
            </CardTitle>
            <CardDescription>Different plant records using the same serial number. They are kept as separate plants.</CardDescription>
          </CardHeader>
          <CardContent>
            {all.data && sharedSerials.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
            <ul className="space-y-2 text-sm">
              {sharedSerials.map(([serial, ps]) => (
                <li key={serial}>
                  <Badge variant="outline" className="font-mono">{serial}</Badge>
                  <ul className="mt-1 ml-1 space-y-0.5">
                    {ps.map((p) => (
                      <li key={p.id}>
                        <Link href={`/plants/${p.id}`} className="block truncate text-muted-foreground hover:text-primary">
                          {p.display_name ?? p.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
