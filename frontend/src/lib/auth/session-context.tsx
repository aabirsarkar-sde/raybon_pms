"use client"

import { createContext, useContext } from "react"

import type { Role, User } from "@/lib/api/types"

/** Mirrors the API's role ranks (api/pdm_api/auth.py). UI hides what the API would refuse. */
const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 }

export type Permission = "view" | "edit" | "admin"
const REQUIRED: Record<Permission, Role> = { view: "viewer", edit: "editor", admin: "admin" }

export interface Session {
  user: User
  can: (p: Permission) => boolean
}

const SessionContext = createContext<Session | null>(null)

export function SessionProvider({ user, children }: { user: User; children: React.ReactNode }) {
  const value: Session = { user, can: (p) => RANK[user.role] >= RANK[REQUIRED[p]] }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error("useSession must be used inside SessionProvider")
  return s
}
