"use client"

import { Factory, Search } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { usePlants } from "@/lib/api/hooks"
import { useDebounced } from "@/hooks/use-debounced"

/** Quick plant selector (⌘K) — the modern equivalent of the legacy plant dropdown. */
export function PlantSwitcher() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const debounced = useDebounced(q, 200)
  const router = useRouter()
  const { data, isFetching } = usePlants({ q: debounced || undefined, limit: 20 }, open)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      <Button
        variant="outline"
        className="h-8 w-full max-w-sm min-w-0 shrink justify-start gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
        data-testid="plant-switcher"
      >
        <Search />
        <span className="truncate">Find a plant…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Find a plant" description="Search by plant name or serial number">
        <Command shouldFilter={false}>
        <CommandInput placeholder="Plant name or serial number…" value={q} onValueChange={setQ} />
        <CommandList>
          <CommandEmpty>{isFetching ? "Searching…" : "No plants found."}</CommandEmpty>
          {data && data.items.length > 0 && (
            <CommandGroup heading={debounced ? `${data.total} match${data.total === 1 ? "" : "es"}` : "Plants"}>
              {data.items.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.id} ${p.display_name ?? ""} ${p.name} ${p.serial_number ?? ""}`}
                  onSelect={() => {
                    setOpen(false)
                    router.push(`/plants/${p.id}`)
                  }}
                >
                  <Factory className="text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{p.display_name ?? p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.zone?.name ?? "No zone"}
                      {p.legacy_plant_id !== null && ` · Legacy #${p.legacy_plant_id}`}
                    </div>
                  </div>
                  {p.serial_number && <span className="font-mono text-xs text-muted-foreground">{p.serial_number}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
        </Command>
      </CommandDialog>
    </>
  )
}
