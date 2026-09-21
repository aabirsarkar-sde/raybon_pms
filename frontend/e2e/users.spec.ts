import { expect, test, type Browser, type Page } from "@playwright/test"

import { login, openPlant, signIn } from "./helpers"

const P = "new-user-pass-1"

async function newSession(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  return { ctx, page: await ctx.newPage() }
}

async function userAction(page: Page, username: string, action: RegExp | string) {
  await page.getByRole("button", { name: `Actions for ${username}` }).click()
  await page.getByRole("menuitem", { name: action }).click()
}

async function createUser(page: Page, username: string, role: "Viewer" | "Editor" | "Admin", fullName?: string) {
  await page.goto("/users")
  await page.getByRole("button", { name: "New user" }).click()
  const d = page.getByRole("dialog")
  await d.getByLabel("Username").fill(username)
  if (fullName) await d.getByLabel("Full name (optional)").fill(fullName)
  await d.getByRole("combobox").click()
  await page.getByRole("option", { name: role }).click()
  await d.getByLabel("Password", { exact: true }).fill(P)
  await d.getByLabel("Repeat password").fill(P)
  await d.getByRole("button", { name: "Create user" }).click()
  await expect(page.getByText(`User ${username} created`)).toBeVisible()
}

test("editors cannot manage users", async ({ page }) => {
  await login(page, "editor")
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0)
  await page.goto("/users")
  await expect(page.getByText("Admins only")).toBeVisible()
})

test("admin creates a user; role changes and deactivation apply immediately", async ({ page, browser }) => {
  await login(page, "admin")
  await createUser(page, "e2e.person", "Viewer", "E2E Person")
  const row = page.locator("tr[data-username='e2e.person']")
  await expect(row).toContainText("E2E Person")
  await expect(row).toContainText("viewer")

  // The new user signs in with viewer rights.
  const other = await newSession(browser)
  await signIn(other.page, "E2E.Person", P) // usernames are case-insensitive
  await other.page.waitForURL("/")
  await expect(other.page.getByRole("heading", { name: "Welcome, E2E Person" })).toBeVisible()
  await openPlant(other.page, 1)
  await expect(other.page.getByRole("button", { name: /^Edit / })).toHaveCount(0)

  // Promote to editor: takes effect on their next page load, no re-login.
  await userAction(page, "e2e.person", /Edit name \/ role/)
  const d = page.getByRole("dialog")
  await d.getByRole("combobox").click()
  await page.getByRole("option", { name: "Editor" }).click()
  await d.getByRole("button", { name: "Save" }).click()
  await expect(row).toContainText("editor")
  await other.page.reload()
  await expect(other.page.getByRole("button", { name: /^Edit / }).first()).toBeVisible()

  // Deactivate: their session ends.
  await userAction(page, "e2e.person", "Deactivate…")
  await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click()
  await expect(row).toContainText("Deactivated")
  await other.page.reload()
  await expect(other.page).toHaveURL(/\/login/)
  await signIn(other.page, "e2e.person", P)
  await expect(other.page.getByTestId("login-error")).toHaveText("Invalid username or password")
  await other.ctx.close()

  // Admins cannot deactivate themselves.
  await page.getByRole("button", { name: /^Actions for ada\.admin/ }).click()
  await expect(page.getByRole("menuitem", { name: "Deactivate…" })).toHaveCount(0)
})

test("users change their own password", async ({ page, browser }) => {
  await login(page, "admin")
  await createUser(page, "e2e.pw", "Editor")
  const u = await newSession(browser)
  await signIn(u.page, "e2e.pw", P)
  await u.page.waitForURL("/")
  await u.page.getByTestId("user-menu").click()
  await u.page.getByRole("menuitem", { name: "Change password" }).click()
  const d = u.page.getByRole("dialog")
  await d.getByLabel("Current password").fill(P)
  await d.getByLabel("New password", { exact: true }).fill("short")
  await expect(d.getByText("At least 8 characters")).toBeVisible()
  await d.getByLabel("New password", { exact: true }).fill("changed-pass-9")
  await d.getByLabel("Repeat new password").fill("changed-pass-9")
  await d.getByRole("button", { name: "Change password" }).click()
  await expect(u.page.getByText("Password changed")).toBeVisible()
  await u.page.getByTestId("user-menu").click()
  await u.page.getByRole("menuitem", { name: "Sign out" }).click()
  await u.page.waitForURL("/login")
  await signIn(u.page, "e2e.pw", P)
  await expect(u.page.getByTestId("login-error")).toBeVisible()
  await signIn(u.page, "e2e.pw", "changed-pass-9")
  await u.page.waitForURL("/")
  await u.ctx.close()
})

test("repeated wrong passwords lock the account until an admin unlocks it", async ({ page, browser }) => {
  await login(page, "admin")
  await createUser(page, "e2e.lock", "Viewer")
  const u = await newSession(browser)
  for (let i = 0; i < 5; i++) await signIn(u.page, "e2e.lock", "wrong-password")
  await expect(u.page.getByTestId("login-error")).toContainText("Too many failed sign-in attempts")
  await signIn(u.page, "e2e.lock", P)
  await expect(u.page.getByTestId("login-error")).toContainText("Too many failed sign-in attempts")

  await page.reload()
  await expect(page.locator("tr[data-username='e2e.lock']")).toContainText("Locked")
  await userAction(page, "e2e.lock", "Unlock")
  await expect(page.locator("tr[data-username='e2e.lock']")).toContainText("Active")
  await signIn(u.page, "e2e.lock", P)
  await u.page.waitForURL("/")
  await u.ctx.close()
})
