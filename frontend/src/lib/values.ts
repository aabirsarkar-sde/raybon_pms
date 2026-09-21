/** Display helpers. Values are never rewritten — these only decide how to *show* them. */

/** Placeholder spellings found in the legacy data (same rule as the database's is_placeholder()). */
const PLACEHOLDERS = new Set(["n/a", "na", "-", "nil", "none", "null"])

export function isPlaceholder(v: unknown): boolean {
  return typeof v === "string" && PLACEHOLDERS.has(v.trim().toLowerCase())
}

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined
}

export function sameValue(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null)
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export function formatRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.35, "week"],
    [12, "month"],
    [Infinity, "year"],
  ]
  let value = -diff
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit)
    value /= size
  }
  return formatDateTime(iso)
}

export function initials(name: string): string {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean)
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase()
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`
}
