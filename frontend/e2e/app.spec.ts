import { expect, test, type Page } from "@playwright/test"

import { creds, login, openPlant, plantId, rowTexts, section, startEditing } from "./helpers"

const rowIds = (page: Page, slug: string) =>
  section(page, slug).locator("tbody tr[data-row-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-row-id")))

// ====================================================================== authentication
test.describe("authentication", () => {
  test("unauthenticated users are sent to sign-in; wrong passwords are rejected", async ({ page }) => {
    await page.goto("/plants")
    await expect(page).toHaveURL(/\/login\?next=%2Fplants/)
    await page.fill("#username", creds("viewer").username)
    await page.fill("#password", "definitely-wrong")
    await page.click("button[type=submit]")
    await expect(page.getByTestId("login-error")).toHaveText("Invalid username or password")
    await expect(page.locator("#password")).toHaveValue("")
  })

  test("sign in lands on the dashboard; sign out ends the session", async ({ page }) => {
    await login(page, "viewer")
    await expect(page.getByRole("heading", { name: /Welcome, vera\.viewer/ })).toBeVisible()
    await expect(page.getByText("Plants", { exact: true }).first()).toBeVisible()
    await page.getByTestId("user-menu").click()
    await expect(page.getByText(/Read-only access/)).toBeVisible()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await page.waitForURL("/login")
    await page.goto("/plants")
    await expect(page).toHaveURL(/\/login/)
  })
})

// ====================================================================== search / list
test.describe("plant list and search", () => {
  test.beforeEach(async ({ page }) => login(page, "viewer"))

  test("search by name keeps plants with shared serials separate", async ({ page }) => {
    await page.goto("/plants")
    await expect(page.getByText("172 plants")).toBeVisible()
    await page.getByLabel("Search plants").fill("tagros")
    await expect(page).toHaveURL(/q=tagros/)
    const ids = await page.locator("table tbody tr td:first-child").allInnerTexts()
    expect(ids).toContain("1095")
    expect(ids).toContain("1106")
  })

  test("exact serial search, zone filter, pagination, open detail", async ({ page }) => {
    await page.goto("/plants")
    await page.getByRole("radio", { name: "Serial no. (exact)" }).click()
    await page.getByLabel("Search plants").fill("3256")
    await expect(page.getByText("2 plants match your filters")).toBeVisible()
    expect((await page.locator("table tbody tr td:first-child").allInnerTexts()).sort()).toEqual(["1024", "1108"])

    await page.goto("/plants")
    await page.getByLabel("Zone").click()
    await page.getByRole("option", { name: "Dahej (33)" }).click()
    await expect(page.getByText("33 plants match your filters")).toBeVisible()

    await page.goto("/plants")
    await expect(page.getByText("1–50 of 172")).toBeVisible()
    await page.getByRole("button", { name: "Next page" }).click()
    await expect(page.getByText("51–100 of 172")).toBeVisible()

    await page.locator("table tbody tr").first().click()
    await expect(page).toHaveURL(/\/plants\/\d+$/)
    await expect(page.getByTestId("plant-title")).toBeVisible()
  })

  test("quick plant switcher finds a plant by serial number", async ({ page }) => {
    await page.getByTestId("plant-switcher").click()
    await page.getByPlaceholder("Plant name or serial number…").fill("2094")
    await page.getByRole("option", { name: /TORRENT PHARMA/ }).click()
    await expect(page.getByTestId("plant-title")).toContainText("TORRENT PHARMA")
  })

  test("no results shows an empty state", async ({ page }) => {
    await page.goto("/plants?q=zzzz-no-such-plant")
    await expect(page.getByText("No plants found")).toBeVisible()
  })
})

// ====================================================================== plant detail (read)
test.describe("plant detail", () => {
  test.beforeEach(async ({ page }) => login(page, "viewer"))

  test("every section is shown with legacy values verbatim", async ({ page }) => {
    await openPlant(page, 1)
    for (const h of ["Plant", "Modules", "Design Parameters", "Pump & Motor", "Instruments", "HMI & PLC", "VFD", "Dosing Pumps", "HP Pump Accessories", "Filters"])
      await expect(page.getByRole("heading", { name: h, exact: true })).toBeVisible()
    expect((await rowTexts(page, "pumps-and-motors", 2)).slice(0, 4)).toEqual(["PK121", "PK122(S)", "PK131", "PK132(S)"])
    const pk161 = section(page, "pumps-and-motors").locator("tbody tr", { hasText: "PK161" })
    await expect(pk161.locator("td").nth(2)).toHaveText("N/A") // placeholder kept verbatim
    await expect(pk161.locator("td").nth(5)).toHaveText("—") // empty kW shown as no value
    await expect(section(page, "filters").getByText("(unlabelled)").first()).toBeVisible()
    await expect(section(page, "pumps-and-motors").getByText("Legacy: 17")).toBeVisible()
    await expect(page.getByRole("link", { name: /Pump & Motor 17/ })).toBeVisible()
  })

  test("repeated design parameters and missing sections are preserved", async ({ page }) => {
    await openPlant(page, 1071)
    const names = await rowTexts(page, "design-parameters", 2)
    expect(names.slice(0, 4).map((n) => n.replace(/×\d+/, "").trim())).toEqual(["Feed Flow", "Feed Flow", "Feed Conductivity", "Feed Flow"])
    await expect(section(page, "design-parameters").getByText("×3").first()).toBeVisible()

    await openPlant(page, 1173)
    await expect(section(page, "instruments").getByText("Not recorded in the legacy system")).toBeVisible()
    await expect(section(page, "pumps-and-motors").getByText("The legacy system listed no pumps")).toBeVisible()
    await expect(section(page, "design-parameters").getByText("The legacy system listed no parameters")).toBeVisible()
  })

  test("unknown plant shows not found", async ({ page }) => {
    await page.goto("/plants/999999")
    await expect(page.getByText("Plant not found")).toBeVisible()
  })
})

// ====================================================================== roles
test.describe("roles", () => {
  test("viewer sees no edit controls and the API refuses writes", async ({ page }) => {
    await login(page, "viewer")
    const id = await openPlant(page, 1)
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0)
    await page.goto("/plants")
    await expect(page.getByRole("button", { name: "New plant" })).toHaveCount(0)
    const res = await page.request.patch(`/api/pdm/plants/${id}`, {
      headers: { "X-PDM-Client": "web", "Content-Type": "application/json" },
      data: { capacity: "x" },
    })
    expect(res.status()).toBe(403)
  })

  test("editor can edit but cannot create plants", async ({ page }) => {
    await login(page, "editor")
    await openPlant(page, 1)
    await expect(page.getByRole("button", { name: /^Edit / }).first()).toBeVisible()
    await page.goto("/plants")
    await expect(page.getByRole("button", { name: "New plant" })).toHaveCount(0)
  })
})

// ====================================================================== editing
test.describe("editing", () => {
  test.beforeEach(async ({ page }) => login(page, "editor"))

  test("inline edit keeps the original, shows it on compare, and is in history", async ({ page }) => {
    await openPlant(page, 1)
    const s = await startEditing(page, "pumps-and-motors")
    await s.getByLabel("Reason for change").fill("Nameplate check")
    const row = s.locator("tbody tr", { hasText: "PK121" })
    await row.locator("td").nth(6).click() // handle, #, code, make, model, motor make, kW
    await page.getByLabel("Motor kW of PK121").fill("7.5 kW")
    await page.getByLabel("Motor kW of PK121").press("Enter")
    await expect(page.getByText("Saved", { exact: true })).toBeVisible()
    await expect(row.locator("[data-state-modified]")).toHaveText("7.5 kW")
    await expect(row.getByText("Edited")).toBeVisible()

    await s.getByRole("button", { name: /^Finish editing/ }).click()
    await page.getByLabel("Show original values").click()
    await expect(row.getByText("7.5", { exact: true })).toBeVisible()

    await page.getByRole("link", { name: "History" }).click()
    const change = page.getByTestId("change-set").first()
    await expect(change).toContainText("eddie.editor")
    await expect(change).toContainText("Nameplate check")
    await expect(change).toContainText("Pump & Motor › PK121 · Motor kW")
    await expect(change).toContainText("7.5 kW")
  })

  test("validation rejects surrounding spaces without saving", async ({ page }) => {
    await openPlant(page, 1)
    const s = await startEditing(page, "instruments")
    await s.locator("tbody tr").first().locator("td").nth(3).click()
    const input = page.getByLabel(/^Make of /)
    await input.fill("KROHNE ")
    await expect(page.getByText("Remove spaces at the start or end")).toBeVisible()
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled()
    await input.press("Escape")
  })

  test("add at a position, then delete with confirmation", async ({ page }) => {
    await openPlant(page, 2)
    const s = await startEditing(page, "instruments")
    const before = await rowIds(page, "instruments")
    await s.getByRole("button", { name: "Add instrument" }).click()
    const sheet = page.getByRole("dialog")
    await sheet.getByLabel("Name", { exact: true }).fill("PS999")
    await sheet.getByLabel("Make", { exact: true }).fill("ORION")
    await sheet.getByRole("combobox").first().click()
    await page.getByRole("option", { name: /^Before #2/ }).click()
    await sheet.getByLabel("Reason for change").fill("Installed")
    await sheet.getByRole("button", { name: "Add instrument" }).click()
    await expect(page.getByText("Instruments: instrument added")).toBeVisible()
    const newRow = s.locator("tbody tr").nth(1)
    await expect(newRow).toContainText("PS999")
    await expect(newRow.getByText("New")).toBeVisible()
    expect(await rowIds(page, "instruments")).toHaveLength(before.length + 1)

    await newRow.getByRole("button", { name: "Actions for PS999" }).click()
    await page.getByRole("menuitem", { name: "Delete…" }).click()
    const confirm = page.getByRole("alertdialog")
    await expect(confirm).toContainText("PS999")
    await confirm.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("Instruments: instrument deleted")).toBeVisible()
    expect(await rowIds(page, "instruments")).toEqual(before)
  })

  test("reorder with explicit controls and by drag and drop", async ({ page }) => {
    await openPlant(page, 3)
    const s = await startEditing(page, "vfds")
    const before = await rowIds(page, "vfds")
    await s.locator("tbody tr").first().getByRole("button", { name: /^Actions for/ }).click()
    await page.getByRole("menuitem", { name: "Move down" }).click()
    await expect(page.getByText("Order saved").first()).toBeVisible()
    await expect.poll(() => rowIds(page, "vfds")).toEqual([before[1], before[0], ...before.slice(2)])

    const d = await startEditing(page, "dosing-pumps")
    const dBefore = await rowIds(page, "dosing-pumps")
    const handle = d.locator("tbody tr").first().getByRole("button", { name: "Drag to reorder" })
    const target = d.locator("tbody tr").nth(2)
    const hb = (await handle.boundingBox())!
    const tb = (await target.boundingBox())!
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + hb.width / 2, hb.y + 10, { steps: 5 })
    await page.mouse.move(hb.x + hb.width / 2, tb.y + tb.height / 2 + 4, { steps: 15 })
    await page.mouse.up()
    await expect(page.getByText("Order saved").first()).toBeVisible()
    const expected = [dBefore[1], dBefore[2], dBefore[0], ...dBefore.slice(3)]
    await expect.poll(() => rowIds(page, "dosing-pumps")).toEqual(expected)
    await page.reload()
    await expect.poll(() => rowIds(page, "dosing-pumps")).toEqual(expected)
  })

  test("design parameter edited in the drawer; duplicates untouched", async ({ page }) => {
    await openPlant(page, 1071)
    const s = await startEditing(page, "design-parameters")
    await s.locator("tbody tr").first().getByRole("button", { name: /^Actions for/ }).click()
    await page.getByRole("menuitem", { name: "Edit row…" }).click()
    const sheet = page.getByRole("dialog")
    await expect(sheet.getByText("Legacy value:").first()).toBeVisible()
    await sheet.getByLabel("Value", { exact: true }).fill("<25")
    await sheet.getByRole("button", { name: "Save changes" }).click()
    await expect(page.getByText("Changes saved")).toBeVisible()
    await expect(s.locator("tbody tr").first()).toContainText("<25")
    await expect(s.getByText("×3").first()).toBeVisible()
  })

  test("modules: text edit derives quantity and type", async ({ page }) => {
    await openPlant(page, 2)
    const s = await startEditing(page, "modules")
    const row = s.locator("tbody tr", { hasText: "2nd Stage" })
    await row.locator("td").nth(1).click()
    await page.getByLabel("2nd Stage value").fill("4 (PT)")
    await page.getByLabel("2nd Stage value").press("Enter")
    await expect(page.getByText("2nd Stage saved")).toBeVisible()
    await expect(row.locator("td").nth(2)).toHaveText("4")
    await expect(row.locator("td").nth(3)).toHaveText("PT")
  })

  test("filters: label an unlabelled value, add and delete a value", async ({ page }) => {
    await openPlant(page, 1)
    const s = await startEditing(page, "filters")
    const panel = s.locator("[data-group-id]").first()
    await panel.getByText("(unlabelled — click to add label)").first().click()
    await page.getByLabel("label 1").fill("Size")
    await page.getByLabel("label 1").press("Enter")
    await expect(panel.locator("li").first()).toContainText("Size")

    await panel.getByRole("button", { name: "Add value" }).last().click()
    const sheet = page.getByRole("dialog")
    await sheet.getByLabel("Value", { exact: true }).fill("Spare")
    await sheet.getByRole("button", { name: "Add value" }).click()
    await expect(panel.locator("li")).toHaveCount(5)
    await expect(panel.locator("li").nth(4)).toContainText("Spare")

    await panel.getByRole("button", { name: "Actions for value 5" }).click()
    await page.getByRole("menuitem", { name: /Delete value/ }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
    await expect(panel.locator("li")).toHaveCount(4)
  })

  test("HP pump accessories: add a group with entries", async ({ page }) => {
    await openPlant(page, 1)
    const s = await startEditing(page, "hp-pump-accessories")
    await s.getByRole("button", { name: "Add accessory group" }).click()
    const sheet = page.getByRole("dialog")
    await sheet.getByLabel("Group name").fill("Coupling")
    await sheet.getByLabel("Label 1").fill("Make")
    await sheet.getByLabel("Value 1").fill("Lovejoy")
    await sheet.getByRole("button", { name: "Add accessory group" }).click()
    const panel = s.locator("[data-group-id]", { hasText: "Coupling" })
    await expect(panel).toContainText("Lovejoy")
    await expect(panel.getByText("New").first()).toBeVisible()
  })

  test("optimistic concurrency: a stale edit is refused and fresh data loads", async ({ page }) => {
    const id = await openPlant(page, 5)
    const list = await (await page.request.get(`/api/pdm/plants/${id}/pumps-and-motors`)).json()
    const first = list.items[0]
    const s = await startEditing(page, "pumps-and-motors")
    // Someone else changes the row after this page loaded.
    const other = await page.request.patch(`/api/pdm/plants/${id}/pumps-and-motors/${first.id}`, {
      headers: { "X-PDM-Client": "web", "Content-Type": "application/json" },
      data: { pump_make: "CHANGED ELSEWHERE", expected_updated_at: first.updated_at },
    })
    expect(other.ok()).toBeTruthy()
    await s.locator("tbody tr").first().locator("td").nth(3).click()
    await page.getByLabel(/^Pump Make of /).fill("MY EDIT")
    await page.getByLabel(/^Pump Make of /).press("Enter")
    await expect(page.getByText("Someone else changed this record")).toBeVisible()
    await page.getByLabel(/^Pump Make of /).press("Escape")
    await expect(s.locator("tbody tr").first()).toContainText("CHANGED ELSEWHERE")
  })
})

// ====================================================================== admin
test("admin creates and deletes a plant", async ({ page }) => {
  await login(page, "admin")
  await page.goto("/plants")
  await page.getByRole("button", { name: "New plant" }).click()
  const sheet = page.getByRole("dialog")
  await sheet.getByLabel("Plant name (required)").fill("E2E Test Plant")
  await sheet.getByLabel("Serial number").fill("2094")
  await sheet.getByRole("button", { name: "Create plant" }).click()
  await expect(page.getByTestId("plant-title")).toHaveText("E2E Test Plant")
  await expect(section(page, "pumps-and-motors").getByText("No pumps recorded")).toBeVisible()
  await expect(page.getByRole("link", { name: "Legacy source" })).toHaveCount(0)
  await page.getByRole("button", { name: "Plant actions" }).click()
  await page.getByRole("menuitem", { name: "Delete plant" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
  await page.waitForURL("/plants")
})

// ====================================================================== legacy source
test("legacy source is read-only and complete", async ({ page }) => {
  await login(page, "editor")
  await openPlant(page, 10, "/legacy")
  await expect(page.getByText("Read-only legacy source.")).toBeVisible()
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0)
  await expect(page.getByText(/^[0-9a-f]{64}$/)).toBeVisible()
  await expect(page.getByRole("row", { name: /Pump And Motor 3 3 0 0 0/ })).toBeVisible()
  await expect(page.getByRole("row", { name: /Filters \(not shown\) 0 0 0 0 0/ })).toBeVisible()
  await page.getByRole("button", { name: "Raw structured record (JSON)" }).click()
  await expect(page.locator("pre")).toContainText('"plant_id": 10')
})

// ====================================================================== error states
test("API failures show an error with retry", async ({ page }) => {
  await login(page, "viewer")
  await page.route("**/api/pdm/plants?**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"The Plant Data API is unavailable"}' }))
  await page.goto("/plants")
  await expect(page.getByText("The Plant Data API is unavailable")).toBeVisible({ timeout: 15_000 })
  await page.unroute("**/api/pdm/plants?**")
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(page.getByText("172 plants")).toBeVisible()
})

// ====================================================================== responsive
test("mobile layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await login(page, "editor")
  const id = await plantId(page, 1)
  for (const path of ["/", "/plants", `/plants/${id}`, `/plants/${id}/history`, `/plants/${id}/legacy`]) {
    await page.goto(path)
    await page.waitForLoadState("networkidle")
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1)
  }
  await page.getByRole("button", { name: "Toggle Sidebar" }).click()
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible()
})
