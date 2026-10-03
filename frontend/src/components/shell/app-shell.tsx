"use client"

import { Factory, History, LayoutDashboard, List, Moon, PackageSearch, Sun, Users } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { useRecentPlants } from "@/hooks/use-recent-plants"
import { useSession } from "@/lib/auth/session-context"

import { PlantSwitcher } from "./plant-switcher"
import { UserMenu } from "./user-menu"

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, match: (p: string) => p === "/", admin: false },
  { href: "/plants", label: "Plants", icon: List, match: (p: string) => p.startsWith("/plants"), admin: false },
  {
    href: "/equipment",
    label: "Equipment",
    icon: PackageSearch,
    match: (p: string) => p.startsWith("/equipment"),
    admin: false,
  },
  { href: "/users", label: "Users", icon: Users, match: (p: string) => p.startsWith("/users"), admin: true },
]

function AppSidebar() {
  const pathname = usePathname()
  const { items: recent } = useRecentPlants()
  const { setOpenMobile } = useSidebar()
  const { can } = useSession()
  const close = () => setOpenMobile(false)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/" onClick={close}>
                <div className="grid size-8 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
                  <Factory className="size-4" />
                </div>
                <div className="grid leading-tight">
                  <span className="font-semibold">Plant Data</span>
                  <span className="text-xs text-sidebar-foreground/60">Management System</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.filter((n) => !n.admin || can("admin")).map((n) => (
                <SidebarMenuItem key={n.href}>
                  <SidebarMenuButton asChild isActive={n.match(pathname)} tooltip={n.label}>
                    <Link href={n.href} onClick={close}>
                      <n.icon /> <span>{n.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {recent.length > 0 && (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>
              <History className="mr-1.5 size-3.5" /> Recently viewed
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {recent.map((p) => (
                  <SidebarMenuItem key={p.id}>
                    <SidebarMenuButton asChild size="sm" isActive={pathname.startsWith(`/plants/${p.id}`)}>
                      <Link href={`/plants/${p.id}`} onClick={close} title={p.label}>
                        <span className="truncate">{p.label}</span>
                        {p.serial && (
                          <span className="ml-auto shrink-0 font-mono text-[10px] text-sidebar-foreground/50">{p.serial}</span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5" />
          <PlantSwitcher />
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>
        <div className="min-w-0 flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
