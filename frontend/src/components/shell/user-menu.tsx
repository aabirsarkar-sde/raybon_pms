"use client"

import { ChevronsUpDown, KeyRound, LogOut, ShieldCheck } from "lucide-react"
import { useState } from "react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"
import { useSession } from "@/lib/auth/session-context"
import { initials } from "@/lib/values"

import { ChangePasswordDialog } from "./change-password-dialog"

const ROLE_TEXT = {
  viewer: "Read-only access",
  editor: "Can edit plant data",
  admin: "Can edit plants and manage users",
} as const

export function UserMenu() {
  const { user } = useSession()
  const [changing, setChanging] = useState(false)
  const shown = user.display_name ?? user.name

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" })
    // Full reload on purpose: clears all cached data of the signed-out user.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login"
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" data-testid="user-menu">
              <Avatar className="size-8 rounded-md">
                <AvatarFallback className="rounded-md bg-sidebar-accent text-xs">{initials(shown)}</AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 leading-tight">
                <span className="truncate text-sm font-medium">{shown}</span>
                <span className="text-xs text-sidebar-foreground/60 capitalize">{user.role}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="font-medium">{shown}</div>
              {user.display_name && <div className="text-xs text-muted-foreground">@{user.username}</div>}
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" />
                <span className="capitalize">{user.role}</span> · {ROLE_TEXT[user.role]}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {user.auth === "password" && (
              <DropdownMenuItem onSelect={() => setChanging(true)}>
                <KeyRound /> Change password
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={signOut}>
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
