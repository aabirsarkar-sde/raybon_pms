"use client"

import { Check, ChevronsUpDown, X } from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface FacetOption {
  value: string
  label?: string
  /** Matching rows, shown on the right of each option. */
  count?: number
  /** Secondary count, e.g. how many plants those rows are in. */
  secondary?: number
  /** How many spellings differing only in case this option covers. */
  spellings?: number
}

/**
 * A multi-select filter over one dimension (Make, Model, Type, Zone…).
 *
 * The option list carries counts, because "which makes are in these results, and
 * how many of each" is the question being answered — not just "pick a value".
 * Values already chosen stay listed even when the current results no longer offer
 * them, so a selection can always be undone.
 */
export function FacetSelect({
  label,
  options,
  selected,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText = "No matches",
  truncated,
  countLabel = "items",
  className,
  disabled,
}: {
  label: string
  options: FacetOption[]
  selected: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  /** True when the server sent only the commonest values. */
  truncated?: boolean
  countLabel?: string
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const chosen = new Set(selected.map((v) => v.toLowerCase()))
  // Keep a chosen value visible even if it is not in the current option list.
  const missing = selected.filter((v) => !options.some((o) => o.value.toLowerCase() === v.toLowerCase()))
  const all: FacetOption[] = [...missing.map((value) => ({ value })), ...options]

  function toggle(value: string) {
    const lower = value.toLowerCase()
    onChange(
      chosen.has(lower) ? selected.filter((v) => v.toLowerCase() !== lower) : [...selected, value],
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-9 min-w-0 justify-between gap-1 font-normal", className)}
        >
          <span className="truncate">
            {label}
            {selected.length > 0 && (
              <span className="text-muted-foreground">
                : {selected.length === 1 ? selected[0] : `${selected.length} selected`}
              </span>
            )}
            {selected.length === 0 && placeholder && (
              <span className="hidden text-muted-foreground sm:inline"> · {placeholder}</span>
            )}
          </span>
          {selected.length > 0 ? (
            <Badge variant="secondary" className="tabular">
              {selected.length}
            </Badge>
          ) : (
            <ChevronsUpDown className="shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {all.map((o) => {
                const isChosen = chosen.has(o.value.toLowerCase())
                return (
                  <CommandItem key={o.value} value={o.value} onSelect={() => toggle(o.value)}>
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded border",
                        isChosen ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {isChosen && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={o.value}>
                      {o.label ?? o.value}
                      {(o.spellings ?? 1) > 1 && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          +{(o.spellings ?? 1) - 1} spelling{o.spellings === 2 ? "" : "s"}
                        </span>
                      )}
                    </span>
                    {o.count !== undefined && (
                      <span className="shrink-0 text-xs text-muted-foreground tabular">
                        {o.count}
                        {o.secondary !== undefined && (
                          <span className="opacity-60"> / {o.secondary}</span>
                        )}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {truncated && (
              <>
                <CommandSeparator />
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Only the most common values are listed. Use the search box above to narrow the
                  results if the one you need is missing.
                </p>
              </>
            )}
          </CommandList>
          {selected.length > 0 && (
            <div className="flex items-center justify-between border-t px-2 py-1.5 text-xs text-muted-foreground">
              <span>
                {selected.length} selected
                {options.length > 0 && ` · counts are ${countLabel}`}
              </span>
              <Button variant="ghost" size="sm" className="h-7" onClick={() => onChange([])}>
                <X className="size-3" /> Clear
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/** The chosen values of every filter, as removable chips. */
export function ActiveFilters({
  groups,
  onClearAll,
}: {
  groups: { label: string; values: string[]; onRemove: (value: string) => void }[]
  onClearAll: () => void
}) {
  const total = groups.reduce((n, g) => n + g.values.length, 0)
  if (total === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {groups.map((g) =>
        g.values.map((v) => (
          <Badge key={`${g.label}:${v}`} variant="secondary" className="gap-1 pr-1 font-normal">
            <span className="text-muted-foreground">{g.label}</span>
            <span className="max-w-48 truncate">{v}</span>
            <button
              type="button"
              aria-label={`Remove ${g.label} filter ${v}`}
              className="rounded-sm p-0.5 hover:bg-background/80"
              onClick={() => g.onRemove(v)}
            >
              <X className="size-3" />
            </button>
          </Badge>
        )),
      )}
      {total > 1 && (
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onClearAll}>
          Clear all
        </Button>
      )}
    </div>
  )
}
