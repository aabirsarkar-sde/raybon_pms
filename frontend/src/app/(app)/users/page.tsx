import type { Metadata } from "next"

import { UserAdmin } from "@/components/users/user-admin"

export const metadata: Metadata = { title: "Users" }

export default function UsersPage() {
  return <UserAdmin />
}
