import { expect, test } from "@playwright/test"

import { login } from "./helpers"

/**
 * Cross-plant equipment search — the client's question: "search CRN 10-15 and
 * show how many plants have this pump model, across all zones and per zone".
 */

const SEARCH = "Search equipment"

async function openSearch(page: Page) {
  await page.goto("/equipment")
  await expect(page.getByRole("heading", { name: "Equipment search" })).toBeVisible()
}

type Page = import("@playwright/test").Page

/** One of the three headline numbers. Auto-retries, so it waits out the debounce. */
function stat(page: Page, name: "items" | "plants" | "zones") {
  return page.getByTestId(`stat-${name}`)
}

async function statValue(page: Page, name: "items" | "plants" | "zones"): Promise<number> {
  return Number((await stat(page, name).innerText()).replace(/,/g, ""))
}

/** Waits for the search to settle on an expected number of matching items. */
async function expectItems(page: Page, n: number) {
  await expect(stat(page, "items")).toHaveText(n.toLocaleString())
}

function zoneRow(page: Page, name: string) {
  return page.getByTestId(`zone-row-${name}`)
}

async function zoneItems(page: Page, name: string): Promise<number> {
  return Number(await page.getByTestId(`zone-items-${name}`).innerText())
}

test("a viewer can search equipment across every plant", async ({ page }) => {
  await login(page, "viewer")
  // Reachable from the sidebar, not only by URL.
  await page.getByRole("link", { name: "Equipment", exact: true }).click()
  await expect(page).toHaveURL(/\/equipment$/)

  await page.getByLabel(SEARCH).fill("CRN 10-12")
  await expectItems(page, 53)
  await expect(stat(page, "plants")).toHaveText("34")
  await expect(stat(page, "zones")).toHaveText("6")

  // The result is a plant list, each with its match count.
  await expect(page.getByRole("heading", { name: /^Plants/ })).toBeVisible()
  await expect(page.getByText(/\d+ matches?/).first()).toBeVisible()
})

test("the search term lives in the URL, so a result can be shared as a link", async ({ page }) => {
  await login(page, "viewer")
  await openSearch(page)
  await page.getByLabel(SEARCH).fill("CRN 10-12")
  await expect(page).toHaveURL(/[?&]q=CRN\+10-12/)

  // Reloading the link restores the same result.
  await page.reload()
  await expect(page.getByLabel(SEARCH)).toHaveValue("CRN 10-12")
  await expectItems(page, 53)
})

test("selecting one zone narrows the totals but keeps every zone comparable", async ({ page }) => {
  await login(page, "viewer")
  await openSearch(page)
  await page.getByLabel(SEARCH).fill("CRN 10-12")
  await expectItems(page, 53)
  const vadodara = await zoneItems(page, "Vadodara")

  await zoneRow(page, "Vadodara").click()
  await expect(page).toHaveURL(/zone_id=/)
  await expect(page.getByText("Counts cover every zone", { exact: false })).toBeVisible()

  await expectItems(page, vadodara)
  await expect(stat(page, "zones")).toHaveText("1")
  // Every zone is still listed with its own count, so the zones stay comparable.
  await expect(zoneRow(page, "Ankleshwar")).toBeVisible()
  await expect(zoneRow(page, "Jhagadia")).toBeVisible()
  expect(await zoneItems(page, "Ankleshwar")).toBeGreaterThan(0)
})

test("several zones can be selected at once, and the counts add up", async ({ page }) => {
  await login(page, "viewer")
  await openSearch(page)
  await page.getByLabel(SEARCH).fill("CRN 10-12")
  await expectItems(page, 53)

  const ankleshwar = await zoneItems(page, "Ankleshwar")
  const jhagadia = await zoneItems(page, "Jhagadia")

  await zoneRow(page, "Ankleshwar").click()
  await zoneRow(page, "Jhagadia").click()
  await expectItems(page, ankleshwar + jhagadia)

  // Both appear as removable filter chips.
  await expect(page.getByRole("button", { name: "Remove Zone filter Ankleshwar" })).toBeVisible()
  await page.getByRole("button", { name: "Remove Zone filter Jhagadia" }).click()
  await expectItems(page, ankleshwar)
})

test("a zone with no matching equipment is shown, with zero", async ({ page }) => {
  await login(page, "viewer")
  await openSearch(page)
  await page.getByLabel(SEARCH).fill("CRN 10-12")
  await expectItems(page, 53)
  const panoli = zoneRow(page, "Panoli")
  await expect(panoli).toBeVisible()
  await expect(panoli).toBeDisabled() // nothing to drill into
})

test("filtering by make, model and type", async ({ page }) => {
  await login(page, "viewer")
  await openSearch(page)
  await page.getByLabel(SEARCH).fill("CRN 10-12")
  await expectItems(page, 53)

  // The Model facet offers the exact models behind the free-text match.
  await page.getByRole("combobox", { name: /^Model/ }).click()
  await expect(page.getByRole("option", { name: /CRN 10-12 SF/ })).toBeVisible()
  await page.getByRole("option", { name: /^CRN 10-12\b/ }).first().click()
  await page.keyboard.press("Escape")

  await expectItems(page, 31)
  await expect(stat(page, "plants")).toHaveText("21")
  await expect(page.getByRole("button", { name: /Remove Model filter/ })).toBeVisible()

  // The Make facet groups spellings that differ only in case.
  await page.getByRole("combobox", { name: /^Make/ }).click()
  // "GRUNDFOS" and "Grundfos" are one option; "GRUNDFOSE" is a different spelling and stays separate.
  await expect(page.getByRole("option", { name: /^grundfos\b/i })).toHaveCount(1)
  await expect(page.getByRole("option", { name: /^GRUNDFOSE\b/ })).toBeVisible()
  await page.keyboard.press("Escape")
})

test("each equipment list can be searched on its own", async ({ page }) => {
  await login(page, "viewer")
  await openSearch(page)
  await page.getByLabel(SEARCH).fill("siemens")
  await expect(stat(page, "items")).not.toHaveText("0")

  // The chips carry live counts; picking one narrows the results to that list.
  const hmi = page.getByRole("button", { name: /^HMI & PLC/ })
  await expect(hmi).toBeVisible()
  await hmi.click()
  await expect(page).toHaveURL(/kind=hmi_plc/)
  expect(await statValue(page, "items")).toBeGreaterThan(0)

  // The other lists still show their counts, so you can switch between them.
  await expect(page.getByRole("button", { name: /^Motors/ })).toBeVisible()
  await page.getByRole("button", { name: "All equipment" }).click()
  await expect(page).not.toHaveURL(/kind=/)
})

test("a match links through to the plant it is in", async ({ page }) => {
  await login(page, "viewer")
  await openSearch(page)
  await page.getByLabel(SEARCH).fill("CRN 10-12")
  await expectItems(page, 53)

  const firstPlant = page.locator("#results-heading").locator("../..").getByRole("link").first()
  const name = (await firstPlant.innerText()).trim()
  await firstPlant.click()
  await expect(page.getByTestId("plant-title")).toHaveText(name)
})

test("searching for something that does not exist says so clearly", async ({ page }) => {
  await login(page, "viewer")
  await openSearch(page)
  await page.getByLabel(SEARCH).fill("no-such-equipment-anywhere")
  await expect(page.getByText("No equipment matches")).toBeVisible()
  await expectItems(page, 0)
  await page.getByRole("button", { name: "Clear filters" }).click()
  await expect(page.getByLabel(SEARCH)).toHaveValue("")
})

test("an edit made in the app is searchable at once", async ({ page }) => {
  await login(page, "editor")
  await openSearch(page)
  await page.getByLabel(SEARCH).fill("E2E-SEARCHABLE-MODEL")
  await expect(page.getByText("No equipment matches")).toBeVisible()

  // Add an instrument with that model through the API the UI itself uses.
  const plants = await (await page.request.get("/api/pdm/plants?limit=1")).json()
  const created = await page.request.post(`/api/pdm/plants/${plants.items[0].id}/instruments`, {
    headers: { "X-PDM-Client": "web", "Content-Type": "application/json" },
    data: { name: "E2E meter", make: "ACME", model: "E2E-SEARCHABLE-MODEL" },
  })
  expect(created.ok()).toBeTruthy()

  await page.reload()
  await expectItems(page, 1)
  await expect(page.getByText("E2E-SEARCHABLE-MODEL")).toBeVisible()

  // Clean up so the rest of the suite sees the seeded data.
  const id = (await created.json()).id
  await page.request.delete(`/api/pdm/plants/${plants.items[0].id}/instruments/${id}`, {
    headers: { "X-PDM-Client": "web" },
  })
})
