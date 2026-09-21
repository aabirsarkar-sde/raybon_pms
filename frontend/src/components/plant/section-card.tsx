"use client"

import { Check, Pencil, Plus } from "lucide-react"

import { EmptyState } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { LegacySectionInfo } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { cn } from "@/lib/utils"

import { ReasonInput } from "./editing"

export interface EditState {
  editing: boolean
  setEditing: (v: boolean) => void
  note: string
  setNote: (v: string) => void
}

/** Shows how the legacy system presented this section. */
export function LegacyChip({ legacy, current }: { legacy: LegacySectionInfo | null; current: number }) {
  if (!legacy) return null
  const text = !legacy.rendered ? "Not in legacy" : `Legacy: ${legacy.count ?? current}`
  const tip = !legacy.rendered
    ? "The legacy system did not show this section for this plant."
    : legacy.count !== null && legacy.count !== current
      ? `The legacy system listed ${legacy.count}; ${current} now.`
      : "Number of entries the legacy system listed."
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "h-5 font-normal text-muted-foreground",
            legacy.rendered && legacy.count !== null && legacy.count !== current && "border-modified/50 text-modified-foreground",
          )}
        >
          {text}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

export function SectionCard({
  id,
  title,
  icon: Icon,
  count,
  legacy,
  edit,
  onAdd,
  addLabel,
  children,
  className,
  bodyClassName,
}: {
  id: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  count?: number
  legacy?: LegacySectionInfo | null
  edit?: EditState
  onAdd?: () => void
  addLabel?: string
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  const { can } = useSession()
  const editable = can("edit") && edit
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "min-w-0 scroll-mt-44 overflow-hidden rounded-lg border bg-card",
        edit?.editing && "ring-2 ring-primary/30",
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Icon className="size-4 text-primary" />
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          {title}
        </h2>
        {count !== undefined && <span className="text-xs text-muted-foreground tabular">{count}</span>}
        {legacy !== undefined && <LegacyChip legacy={legacy} current={count ?? 0} />}
        <div className="ml-auto flex items-center gap-1">
          {editable && edit.editing && onAdd && (
            <Button size="xs" variant="outline" onClick={onAdd}>
              <Plus /> {addLabel ?? "Add"}
            </Button>
          )}
          {editable && (
            <Button
              size="xs"
              variant={edit.editing ? "default" : "ghost"}
              onClick={() => edit.setEditing(!edit.editing)}
              aria-pressed={edit.editing}
              aria-label={edit.editing ? `Finish editing ${title}` : `Edit ${title}`}
            >
              {edit.editing ? (
                <>
                  <Check /> Done
                </>
              ) : (
                <>
                  <Pencil /> Edit
                </>
              )}
            </Button>
          )}
        </div>
        {editable && edit.editing && (
          <div className="basis-full">
            <ReasonInput compact id={`${id}-note`} value={edit.note} onChange={edit.setNote} />
          </div>
        )}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/** Empty states that distinguish "not in legacy" from "legacy showed it empty". */
export function SectionEmpty({
  legacy,
  noun,
  canAdd,
  onAdd,
}: {
  legacy: LegacySectionInfo | null | undefined
  noun: string
  canAdd: boolean
  onAdd?: () => void
}) {
  const title = !legacy
    ? `No ${noun}s recorded`
    : !legacy.rendered
      ? "Not recorded in the legacy system"
      : `The legacy system listed no ${noun}s`
  const message = !legacy
    ? undefined
    : !legacy.rendered
      ? "The legacy page did not include this section for this plant."
      : "The section existed in the legacy system but had no entries."
  return (
    <EmptyState
      compact
      title={title}
      message={message}
      action={
        canAdd && onAdd ? (
          <Button size="sm" variant="outline" onClick={onAdd}>
            <Plus /> Add {noun}
          </Button>
        ) : undefined
      }
    />
  )
}
