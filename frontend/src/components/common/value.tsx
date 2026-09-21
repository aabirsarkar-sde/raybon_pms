"use client"

import { createContext, useContext } from "react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Origin } from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { isPlaceholder, sameValue } from "@/lib/values"

/**
 * Renders a stored value verbatim.
 *  - null            -> "—" marked as empty (no value in the source)
 *  - "N/A", "NA", …  -> shown exactly, styled as a placeholder
 */
export function ValueText({ value, mono, className }: { value: unknown; mono?: boolean; className?: string }) {
  if (value === null || value === undefined) {
    return (
      <span className={cn("text-muted-foreground/60 select-none", className)} title="No value" aria-label="No value">
        —
      </span>
    )
  }
  const text = String(value)
  if (isPlaceholder(text)) {
    return (
      <span
        className={cn("text-muted-foreground", mono && "font-mono text-[0.8em]", className)}
        title="Placeholder recorded in the source data (kept verbatim)"
      >
        {text}
      </span>
    )
  }
  return <span className={cn("whitespace-pre-wrap", mono && "font-mono text-[0.8em]", className)}>{text}</span>
}

/** When on, modified values show their original inline instead of only in a tooltip. */
export const CompareContext = createContext(false)
export const useCompare = () => useContext(CompareContext)

/**
 * A current value, marked when it differs from the legacy original.
 * `original === undefined` means there is no original to compare with (row added in the new system).
 */
export function DiffValue({
  current,
  original,
  hasOriginal,
  mono,
  className,
}: {
  current: unknown
  original?: unknown
  hasOriginal: boolean
  mono?: boolean
  className?: string
}) {
  const compare = useCompare()
  const modified = hasOriginal && !sameValue(current, original)
  if (!modified) return <ValueText value={current} mono={mono} className={className} />
  return (
    <span className={cn("inline-flex flex-col", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-state-modified=""
            className="-mx-1 rounded-sm bg-modified-subtle px-1 underline decoration-modified decoration-dotted decoration-2 underline-offset-4"
          >
            <ValueText value={current} mono={mono} />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span className="text-xs">
            Original: <ValueText value={original} mono={mono} />
          </span>
        </TooltipContent>
      </Tooltip>
      {compare && (
        <span className="mt-0.5 text-xs text-muted-foreground line-through decoration-muted-foreground/50">
          <ValueText value={original} mono={mono} />
        </span>
      )}
    </span>
  )
}

export function OriginBadge({ origin, modified }: { origin: Origin; modified?: boolean }) {
  if (origin === "app")
    return (
      <Badge className="h-4 rounded-sm border-added/30 bg-added-subtle px-1 text-[10px] text-added-foreground" title="Added in the new system — not in the legacy data">
        New
      </Badge>
    )
  if (modified)
    return (
      <Badge className="h-4 rounded-sm border-modified/30 bg-modified-subtle px-1 text-[10px] text-modified-foreground" title="Changed since import from the legacy system">
        Edited
      </Badge>
    )
  return null
}

export function Legend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm border bg-card" /> Unchanged from legacy
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-modified" /> Modified
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-added" /> Added in new system
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="text-muted-foreground/60">—</span> No value
      </span>
    </div>
  )
}
