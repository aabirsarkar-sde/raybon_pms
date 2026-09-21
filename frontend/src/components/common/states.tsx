"use client"

import { AlertTriangle, Inbox, RotateCw } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryHref,
  className,
}: {
  title?: string
  message?: string
  onRetry?: () => void
  retryHref?: string
  className?: string
}) {
  return (
    <div role="alert" className={cn("mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center", className)}>
      <div className="grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <div className="space-y-1">
        <h2 className="font-semibold">{title}</h2>
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      )}
      {retryHref && (
        <Button variant="outline" asChild>
          <Link href={retryHref}>
            <RotateCw /> Try again
          </Link>
        </Button>
      )}
    </div>
  )
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
  compact,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  message?: React.ReactNode
  action?: React.ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 text-center",
        compact ? "px-4 py-6" : "px-6 py-14",
        className,
      )}
    >
      <Icon className={cn("text-muted-foreground/70", compact ? "size-5" : "size-8")} />
      <p className={cn("font-medium", compact && "text-sm")}>{title}</p>
      {message && <p className="max-w-sm text-sm text-muted-foreground">{message}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn("h-5", c === 0 ? "w-16" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  )
}
