"use client"

import { Check, Copy, Download, FileCode2, Lock } from "lucide-react"
import { useState } from "react"

import { ErrorState, TableSkeleton } from "@/components/common/states"
import { ValueText } from "@/components/common/value"
import { usePlantCtx } from "@/components/plant/plant-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useLegacy } from "@/lib/api/hooks"
import type { PlantDoc, Row, StructuredRecord, Text } from "@/lib/api/types"
import { PLANT_FIELDS, SECTIONS, STAGE_LABELS } from "@/lib/sections"
import { cn } from "@/lib/utils"
import { formatDateTime, sameValue } from "@/lib/values"

/** Column headings exactly as the legacy tables showed them. */
const LEGACY_COLUMNS: Record<string, [string, string][]> = {
  pump_and_motor: [
    ["pump_code", "Pump Code"],
    ["pump_make", "Pump · Make"],
    ["pump_model", "Pump · Model"],
    ["motor_make", "Motor · Make"],
    ["motor_kw", "Motor · Kw"],
    ["motor_amp", "Motor · Amp."],
  ],
  instruments: [["name", "Name"], ["make", "Make"], ["model", "Model"]],
  hmi_and_plc: [["name", "Name"], ["make", "Make"], ["model", "Model"]],
  vfd: [["name", "Name"], ["make", "Make"], ["model", "Model"]],
  dosing_pumps: [["dosing_pump_for", "Dosing Pump for"], ["make", "Make"], ["model", "Model"]],
}

function Status({ state }: { state: "same" | "modified" | "removed" | "added" }) {
  const map = {
    same: ["Unchanged", "text-muted-foreground"],
    modified: ["Modified", "border-modified/40 bg-modified-subtle text-modified-foreground"],
    removed: ["Removed", "border-destructive/30 bg-destructive/10 text-destructive"],
    added: ["Added", "border-added/40 bg-added-subtle text-added-foreground"],
  } as const
  return (
    <Badge variant="outline" className={cn("h-5 font-normal", map[state][1])}>
      {map[state][0]}
    </Badge>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check /> : <Copy />}
    </Button>
  )
}

/** Per-section reconciliation between the snapshot and the current working data. */
function reconcile(plant: PlantDoc, rec: StructuredRecord) {
  return SECTIONS.map((s) => {
    const legacyRows = (rec as unknown as Record<string, unknown[] | null>)[s.legacyKey]
    const items = plant.sections[s.key].items as Row[]
    const fromLegacy = items.filter((i) => i.origin === "legacy")
    // A filter / accessory group also counts as edited when one of its values or entries changed or was added.
    const kidsChanged = (i: Row) =>
      !!s.child &&
      ((i as unknown as Record<string, Row[]>)[s.child.key] ?? []).some((k) => k.origin === "app" || k.modified_fields.length > 0)
    const edited = fromLegacy.filter((i) => i.modified_fields.length > 0 || kidsChanged(i)).length
    const legacyCount = legacyRows?.length ?? 0
    return {
      def: s,
      shown: legacyRows !== null,
      legacyCount,
      unchanged: fromLegacy.length - edited,
      edited,
      removed: legacyCount - fromLegacy.length,
      added: items.length - fromLegacy.length,
      current: items.length,
    }
  })
}

function LegacyTable({ headers, rows }: { headers: string[]; rows: Text[][] }) {
  return (
    <Table className="text-[13px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-8 w-8 text-right text-xs">#</TableHead>
          {headers.map((h) => (
            <TableHead key={h} className="h-8 text-xs">
              {h}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            <TableCell className="py-1.5 text-right text-xs text-muted-foreground tabular">{i + 1}</TableCell>
            {r.map((v, j) => (
              <TableCell key={j} className="py-1.5 whitespace-normal">
                <ValueText value={v} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function Block({ title, children, empty }: { title: string; children?: React.ReactNode; empty?: string }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border bg-card">
      <h3 className="border-b bg-muted/30 px-3 py-2 text-sm font-semibold">{title}</h3>
      {empty ? <p className="px-3 py-4 text-sm text-muted-foreground">{empty}</p> : children}
    </section>
  )
}

export function PlantLegacy() {
  const { plant } = usePlantCtx()
  const { data, isLoading, isError, error, refetch } = useLegacy(plant.id)
  if (isLoading) return <TableSkeleton rows={8} cols={4} />
  if (isError) return <ErrorState message={error.message} onRetry={() => refetch()} />
  const snap = data?.records.at(-1)
  if (!snap) return <ErrorState title="No legacy record" message="This plant was not imported from the legacy system." />
  const rec = snap.record
  const recon = reconcile(plant, rec)
  const json = JSON.stringify(rec, null, 2)

  const plantRows: { label: string; legacy: Text; current: Text }[] = [
    ...PLANT_FIELDS.map((f) => ({
      label: f.legacyLabel,
      legacy:
        f.key === "display_name"
          ? ((rec.source.dropdown_label as Text) ?? null)
          : f.key === "zone_name"
            ? rec.zone
            : ((rec.plant as Record<string, Text>)[f.key] ?? null),
      current: (plant.current[f.key] as Text) ?? null,
    })),
    ...plant.modules.map((m) => ({
      label: `Modules · ${STAGE_LABELS[String(m.stage)]}`,
      legacy: rec.modules[m.stage === "total" ? "total" : `stage_${m.stage}`] ?? null,
      current: m.current.value_text,
    })),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-dashed bg-muted/30 p-3 text-sm">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p>
          <span className="font-medium">Read-only legacy source.</span>{" "}
          <span className="text-muted-foreground">
            This is the record imported from the legacy Plant Data system. It cannot be edited or deleted; changes are made on the
            Plant data tab and recorded in History.
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Block title="Provenance">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 p-3 text-sm">
            <dt className="text-muted-foreground">Legacy plant ID</dt>
            <dd className="font-mono">{rec.plant_id}</dd>
            <dt className="text-muted-foreground">Imported</dt>
            <dd>{formatDateTime(snap.import_batch.imported_at)} (batch {snap.import_batch.id})</dd>
            <dt className="text-muted-foreground">Legacy endpoint</dt>
            <dd className="min-w-0 font-mono text-xs break-all">{snap.endpoint ?? "—"}</dd>
            <dt className="text-muted-foreground">Raw HTML</dt>
            <dd className="font-mono text-xs">{snap.raw_file ?? "—"}</dd>
            <dt className="text-muted-foreground">SHA-256</dt>
            <dd className="flex min-w-0 items-center gap-1 font-mono text-xs">
              <span className="truncate" title={snap.raw_sha256 ?? ""}>
                {snap.raw_sha256 ?? "—"}
              </span>
              {snap.raw_sha256 && <CopyButton text={snap.raw_sha256} label="Copy SHA-256" />}
            </dd>
            <dt className="text-muted-foreground">Schema</dt>
            <dd>v{snap.import_batch.schema_version}</dd>
          </dl>
        </Block>

        <Block title="Legacy vs current (rows)">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8 text-xs">Section</TableHead>
                <TableHead className="h-8 text-right text-xs">Legacy</TableHead>
                <TableHead className="h-8 text-right text-xs">Unchanged</TableHead>
                <TableHead className="h-8 text-right text-xs">Edited</TableHead>
                <TableHead className="h-8 text-right text-xs">Removed</TableHead>
                <TableHead className="h-8 text-right text-xs">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recon.map((r) => (
                <TableRow key={r.def.key}>
                  <TableCell className="py-1.5">
                    {r.def.legacyTitle}
                    {!r.shown && <span className="text-xs text-muted-foreground"> (not shown)</span>}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular">{r.legacyCount}</TableCell>
                  <TableCell className="py-1.5 text-right text-muted-foreground tabular">{r.unchanged}</TableCell>
                  <TableCell className={cn("py-1.5 text-right tabular", r.edited && "font-medium text-modified-foreground")}>{r.edited}</TableCell>
                  <TableCell className={cn("py-1.5 text-right tabular", r.removed && "font-medium text-destructive")}>{r.removed}</TableCell>
                  <TableCell className={cn("py-1.5 text-right tabular", r.added && "font-medium text-added-foreground")}>{r.added}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            A filter or accessory group counts as edited when it, or one of its values, changed. See History for every individual change.
          </p>
        </Block>
      </div>

      <Block title="Plant and modules — legacy value alongside current value">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 text-xs">Field (legacy label)</TableHead>
              <TableHead className="h-8 text-xs">Legacy value</TableHead>
              <TableHead className="h-8 text-xs">Current value</TableHead>
              <TableHead className="h-8 w-24 text-xs">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plantRows.map((r) => (
              <TableRow key={r.label}>
                <TableCell className="py-1.5 text-muted-foreground">{r.label}</TableCell>
                <TableCell className="py-1.5 whitespace-normal">
                  <ValueText value={r.legacy} />
                </TableCell>
                <TableCell className="py-1.5 whitespace-normal">
                  <ValueText value={r.current} />
                </TableCell>
                <TableCell className="py-1.5">
                  <Status state={sameValue(r.legacy, r.current) ? "same" : "modified"} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Block>

      <h2 className="pt-2 text-sm font-semibold text-muted-foreground uppercase">Original legacy record</h2>

      <Block title="Design Parameters" empty={rec.design_parameters === null ? "Not shown in the legacy system." : rec.design_parameters.length === 0 ? "Shown with no entries." : undefined}>
        {rec.design_parameters && (
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
            {rec.design_parameters.map((d) => (
              <div key={d.position} className="bg-card px-3 py-2 text-center">
                <div className="text-xs font-medium">{d.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  <ValueText value={d.unit_raw} />
                </div>
                <div className="text-sm tabular">
                  <ValueText value={d.value} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Block>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {(["pump_and_motor", "instruments", "hmi_and_plc", "vfd", "dosing_pumps"] as const).map((k) => {
          const def = SECTIONS.find((s) => s.legacyKey === k)!
          const rows = rec[k]
          return (
            <Block
              key={k}
              title={def.legacyTitle}
              empty={rows === null ? "Not shown in the legacy system." : rows.length === 0 ? "Shown with no entries." : undefined}
            >
              {rows && <LegacyTable headers={LEGACY_COLUMNS[k].map(([, h]) => h)} rows={rows.map((r) => LEGACY_COLUMNS[k].map(([f]) => r[f] ?? null))} />}
            </Block>
          )
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Block
          title="HP Pump Accessories"
          empty={rec.hp_pump_accessories === null ? "Not shown in the legacy system." : rec.hp_pump_accessories.length === 0 ? "Shown with no entries." : undefined}
        >
          <div className="grid gap-px bg-border sm:grid-cols-3">
            {rec.hp_pump_accessories?.map((g) => (
              <div key={g.position} className="bg-card p-3 text-sm">
                <div className="mb-1 border-b pb-1 font-medium">{g.group ?? "—"}</div>
                {g.entries.map((e, i) => (
                  <div key={i}>
                    {e.label !== null && <div className="text-xs text-muted-foreground">{e.label}</div>}
                    <div>
                      <ValueText value={e.value} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Block>
        <Block title="Filters" empty={rec.filters === null ? "Not shown in the legacy system." : rec.filters.length === 0 ? "Shown with no entries." : undefined}>
          <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            {rec.filters?.map((f) => (
              <div key={f.position} className="bg-card p-3 text-center text-sm">
                <div className="mb-1 border-b pb-1 font-medium">{f.name ?? "—"}</div>
                {f.values.map((v, i) => (
                  <div key={i}>
                    <ValueText value={v} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          {rec.filters && <p className="border-t px-3 py-2 text-xs text-muted-foreground">The legacy system showed filter values without labels.</p>}
        </Block>
      </div>

      <Collapsible className="rounded-lg border bg-card">
        <div className="flex items-center gap-2 px-3 py-2">
          <FileCode2 className="size-4 text-muted-foreground" />
          <CollapsibleTrigger asChild>
            <Button variant="link" className="h-auto p-0 text-sm">
              Raw structured record (JSON)
            </Button>
          </CollapsibleTrigger>
          <div className="ml-auto flex items-center gap-1">
            <CopyButton text={json} label="Copy JSON" />
            <Button variant="ghost" size="icon-xs" aria-label="Download JSON" asChild>
              <a href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`} download={`plant_${rec.plant_id}.json`}>
                <Download />
              </a>
            </Button>
          </div>
        </div>
        <CollapsibleContent>
          <pre className="max-h-[32rem] overflow-auto border-t bg-muted/30 p-3 font-mono text-xs">{json}</pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
