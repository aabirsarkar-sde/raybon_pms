"use client"

import {
  ChevronRight,
  Database,
  FileClock,
  FolderOpen,
  LayoutList,
  MoreHorizontal,
  SearchX,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { EmptyState, ErrorState } from "@/components/common/states"
import { CompareContext, Legend, OriginBadge, ValueText } from "@/components/common/value"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useRecentPlants } from "@/hooks/use-recent-plants"
import { ApiError } from "@/lib/api/client"
import { usePlant, usePlantWrite } from "@/lib/api/hooks"
import { useSession } from "@/lib/auth/session-context"
import { COUNTER_ORDER, SECTION_BY_KEY } from "@/lib/sections"
import { cn } from "@/lib/utils"

import { ConfirmDelete } from "./editing"
import { PlantContext } from "./plant-context"

function HeaderSkeleton() {
  return (
    <div className="space-y-3 border-b p-4 md:p-6">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
    </div>
  )
}

export function PlantFrame({ id, children }: { id: number; children: React.ReactNode }) {
  const { data: plant, isLoading, isError, error, refetch } = usePlant(id)
  const { mutateAsync } = usePlantWrite(id)
  const { remember } = useRecentPlants()
  const { can } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [compare, setCompare] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const base = `/plants/${id}`

  useEffect(() => {
    if (plant) remember({ id: plant.id, label: plant.current.display_name ?? plant.current.name, serial: plant.current.serial_number })
  }, [plant, remember])

  if (isLoading) return <HeaderSkeleton />
  if (isError) {
    if (error instanceof ApiError && error.status === 404)
      return (
        <EmptyState
          icon={SearchX}
          title="Plant not found"
          message="This plant does not exist or has been removed."
          action={
            <Button asChild variant="outline">
              <Link href="/plants">Back to plants</Link>
            </Button>
          }
        />
      )
    return <ErrorState message={error.message} onRetry={() => refetch()} />
  }
  if (!plant) return null

  const c = plant.current
  const tabs = [
    { href: base, label: "Plant data", icon: LayoutList, count: undefined as number | undefined },
    { href: `${base}/documents`, label: "Documents", icon: FolderOpen, count: plant.documents },
    { href: `${base}/history`, label: "History", icon: FileClock, count: undefined },
    ...(plant.legacy_plant_id !== null
      ? [{ href: `${base}/legacy`, label: "Legacy source", icon: Database, count: undefined }]
      : []),
  ]
  const onData = pathname === base

  return (
    <PlantContext.Provider value={{ plant, write: mutateAsync, base }}>
      <div className="border-b bg-card/60 md:sticky md:top-12 md:z-20 md:bg-card/95 md:backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 pt-3 md:px-6">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
            <Link href="/plants" className="hover:text-foreground">
              Plants
            </Link>
            <ChevronRight className="size-3" />
            <span className="truncate">{c.display_name ?? c.name}</span>
          </nav>
          <div className="mt-1 flex flex-wrap items-start gap-x-4 gap-y-2">
            {/* min width makes the actions wrap below the title on phones instead of squeezing it */}
            <div className="min-w-[min(100%,18rem)] flex-1">
              <h1 className="text-lg leading-snug font-semibold tracking-tight md:text-xl" data-testid="plant-title">
                {c.display_name ?? c.name}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                {plant.legacy_plant_id !== null && (
                  <Badge variant="outline" className="font-mono">
                    Legacy #{plant.legacy_plant_id}
                  </Badge>
                )}
                <Badge variant="secondary" className="font-mono">
                  S/N <ValueText value={c.serial_number} />
                </Badge>
                <Badge variant="secondary">
                  <ValueText value={c.capacity} />
                </Badge>
                <Badge variant="secondary">Zone: {c.zone_name ?? "—"}</Badge>
                <OriginBadge origin={plant.origin} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onData && plant.origin === "legacy" && (
                <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1">
                  <Switch id="compare" checked={compare} onCheckedChange={setCompare} />
                  <Label htmlFor="compare" className="text-xs">
                    Show original values
                  </Label>
                </div>
              )}
              {can("admin") && plant.origin === "app" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="Plant actions">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                      <Trash2 /> Delete plant
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>

          {/* Section counters, as in the legacy header ("Pump: 17  Instruments: 15 …"). */}
          {onData && (
            <div className="-mx-1 mt-2 flex gap-1 overflow-x-auto pb-1 text-xs">
              {COUNTER_ORDER.map((k) => {
                const s = SECTION_BY_KEY[k]
                const n = plant.sections[k].items.length
                return (
                  <a
                    key={k}
                    href={`#${s.slug}`}
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-muted",
                      n === 0 && "text-muted-foreground",
                    )}
                  >
                    <s.icon className="size-3.5" /> {s.title}
                    <span className="font-semibold tabular">{n}</span>
                  </a>
                )
              })}
            </div>
          )}

          <nav className="-mb-px flex gap-4 overflow-x-auto" aria-label="Plant views">
            {tabs.map((t) => {
              const active = t.href === base ? pathname === base : pathname.startsWith(t.href)
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 border-b-2 px-0.5 py-2 text-sm",
                    active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <t.icon className="size-4" /> {t.label}
                  {t.count !== undefined && t.count > 0 && (
                    <Badge variant="secondary" className="tabular">
                      {t.count}
                    </Badge>
                  )}
                </Link>
              )
            })}
          </nav>
        </div>
      </div>

      <CompareContext.Provider value={compare}>
        <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
          {onData && plant.origin === "legacy" && <Legend />}
          {children}
        </div>
      </CompareContext.Provider>

      {confirmDelete && (
        <ConfirmDelete
          open
          onOpenChange={setConfirmDelete}
          title="Delete this plant?"
          description={
            <p>
              <strong>{c.display_name ?? c.name}</strong> and all of its equipment will be deleted. This plant was created in the
              new system; the deletion is recorded in the audit log.
            </p>
          }
          onConfirm={async (reason) => {
            await mutateAsync({ path: `plants/${id}`, method: "DELETE", reason, success: "Plant deleted" })
            router.push("/plants")
          }}
        />
      )}
    </PlantContext.Provider>
  )
}
