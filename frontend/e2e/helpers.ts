import { expect, type Page } from "@playwright/test"

export type Role = "viewer" | "editor" | "admin"

/** Test accounts: PDM_USER_<ROLE> / PDM_PASS_<ROLE> (e.g. PDM_USER_ADMIN, PDM_PASS_ADMIN). */
export function creds(role: Role): { username: string; password: string } {
  const username = process.env[`PDM_USER_${role.toUpperCase()}`]
  const password = process.env[`PDM_PASS_${role.toUpperCase()}`]
  if (!username || !password) throw new Error(`Set PDM_USER_${role.toUpperCase()} and PDM_PASS_${role.toUpperCase()}`)
  return { username, password }
}

export async function signIn(page: Page, username: string, password: string) {
  await page.goto("/login")
  await page.fill("#username", username)
  await page.fill("#password", password)
  await page.click("button[type=submit]")
}

export async function login(page: Page, role: Role) {
  const c = creds(role)
  await signIn(page, c.username, c.password)
  await page.waitForURL("/")
}

/** Internal plant id for a legacy plant id (through the app's own proxy, as the signed-in user). */
export async function plantId(page: Page, legacyId: number): Promise<number> {
  const res = await page.request.get(`/api/pdm/plants/by-legacy-id/${legacyId}`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()).id
}

export async function openPlant(page: Page, legacyId: number, tab = "") {
  const id = await plantId(page, legacyId)
  await page.goto(`/plants/${id}${tab}`)
  await expect(page.getByTestId("plant-title")).toBeVisible()
  return id
}

export function section(page: Page, slug: string) {
  return page.locator(`section#${slug}`)
}

export async function startEditing(page: Page, slug: string) {
  const s = section(page, slug)
  await s.getByRole("button", { name: /^Edit / }).click()
  await expect(s.getByRole("button", { name: /^Finish editing/ })).toBeVisible()
  return s
}

export async function rowTexts(page: Page, slug: string, col = 2) {
  return section(page, slug).locator("tbody tr").locator(`td:nth-child(${col})`).allInnerTexts()
}
