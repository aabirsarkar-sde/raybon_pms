import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { creds, login, plantId, startEditing } from "./helpers"

/**
 * Layout checks on phone/tablet profiles (see playwright.config.ts "mobile-*" projects):
 *  - the page never scrolls sideways (wide tables scroll inside their own card)
 *  - open dialogs / drawers / menus fit inside the screen
 *  - icons keep a square aspect ratio (not squashed by flex layouts)
 *  - text inputs use >= 16px text, so iOS Safari does not zoom in on focus
 */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const W = window.innerWidth
    const H = window.innerHeight
    const out: string[] = []
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""}.${String(el.getAttribute("class") ?? "").split(" ").slice(0, 3).join(".")}`
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"
    }

    const overflow = document.documentElement.scrollWidth - W
    if (overflow > 1) out.push(`page scrolls sideways by ${overflow}px`)

    for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.left < -1 || r.right > W + 1) out.push(`${name(el)} is wider than the screen (${Math.round(r.left)}..${Math.round(r.right)} of ${W})`)
      if (r.height > H + 1) out.push(`${name(el)} is taller than the screen (${Math.round(r.height)} > ${H})`)
    }

    for (const svg of document.querySelectorAll("svg.lucide")) {
      if (!visible(svg)) continue
      const r = svg.getBoundingClientRect()
      if (Math.abs(r.width - r.height) > 1) out.push(`icon ${name(svg)} squashed to ${r.width.toFixed(1)}x${r.height.toFixed(1)}`)
    }

    for (const el of document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, select")) {
      if (!visible(el)) continue
      const fs = parseFloat(getComputedStyle(el).fontSize)
      if (fs < 16) out.push(`${name(el)} has ${fs}px text (iOS zooms in below 16px)`)
    }
    return [...new Set(out)]
  })
}

async function expectGoodLayout(page: Page, where: string) {
  await page.waitForTimeout(250) // let open/close animations finish
  expect(await layoutProblems(page), where).toEqual([])
}

test("sign-in page fits", async ({ page }) => {
  await page.goto("/login")
  await expectGoodLayout(page, "login")
  await page.fill("#username", "someone")
  await page.fill("#password", "x")
  await expectGoodLayout(page, "login with input focused")
})

test("every page fits the screen", async ({ page }) => {
  await login(page, "editor")
  const p1 = await plantId(page, 1)
  const p1071 = await plantId(page, 1071)
  const p1173 = await plantId(page, 1173)
  for (const path of [
    "/",
    "/plants",
    "/plants?zone_id=2&modified=true",
    `/plants/${p1}`,
    `/plants/${p1071}`,
    `/plants/${p1173}`,
    `/plants/${p1}/history`,
    `/plants/${p1}/legacy`,
    "/plants/999999",
  ]) {
    await page.goto(path)
    await page.waitForLoadState("networkidle")
    await expectGoodLayout(page, path)
  }
  await page.goto(`/plants/${p1}/legacy`)
  await page.getByRole("button", { name: "Raw structured record (JSON)" }).click()
  await expectGoodLayout(page, "legacy with raw JSON open")
})

test("menus, search and filters fit", async ({ page }) => {
  await login(page, "editor")
  const trigger = page.getByRole("button", { name: "Toggle Sidebar" }).first()
  if (await trigger.isVisible()) {
    await trigger.click()
    await expectGoodLayout(page, "navigation open")
    await page.keyboard.press("Escape")
  }
  await page.getByTestId("plant-switcher").click()
  await page.getByPlaceholder("Plant name or serial number…").fill("dahej")
  await expect(page.getByRole("option").first()).toBeVisible()
  await expectGoodLayout(page, "plant switcher open")
  await page.keyboard.press("Escape")

  await page.goto("/plants")
  await page.getByLabel("Zone").click()
  await expectGoodLayout(page, "zone filter open")
  await page.keyboard.press("Escape")
})

test("editing controls fit", async ({ page }) => {
  await login(page, "editor")
  const id = await plantId(page, 1)
  await page.goto(`/plants/${id}`)

  const s = await startEditing(page, "pumps-and-motors")
  await expectGoodLayout(page, "pump table in edit mode")
  await s.locator("tbody tr").first().locator("td").nth(3).click()
  await expect(page.getByLabel(/^Pump Make of /)).toBeFocused()
  await expectGoodLayout(page, "inline editor open")
  await page.getByLabel(/^Pump Make of /).press("Escape")

  await s.locator("tbody tr").first().getByRole("button", { name: /^Actions for/ }).click()
  await expectGoodLayout(page, "row menu open")
  await page.getByRole("menuitem", { name: "Edit row…" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expectGoodLayout(page, "edit drawer open")
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()

  await s.locator("tbody tr").first().getByRole("button", { name: /^Actions for/ }).click()
  await page.getByRole("menuitem", { name: "Delete…" }).click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  await expectGoodLayout(page, "delete confirmation open")
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click()

  const f = await startEditing(page, "filters")
  await f.getByRole("button", { name: "Add filter" }).click()
  await expectGoodLayout(page, "add filter drawer open")
  await page.keyboard.press("Escape")

  // The Plant card edits in a drawer straight away.
  await page.getByRole("button", { name: "Edit Plant" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expectGoodLayout(page, "plant details drawer open")
})

test("user administration fits", async ({ page }) => {
  await login(page, "admin")
  await page.goto("/users")
  await expect(page.getByRole("button", { name: "New user" })).toBeVisible()
  await expectGoodLayout(page, "users page")
  await page.getByRole("button", { name: "New user" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expectGoodLayout(page, "new user dialog")
})

// ====================================================================== equipment search
test("equipment search fits, with filters and zones in use", async ({ page }) => {
  await login(page, "viewer")
  await page.goto("/equipment")
  await expect(page.getByRole("heading", { name: "Equipment search" })).toBeVisible()
  await page.waitForLoadState("networkidle")
  await expectGoodLayout(page, "equipment search, unfiltered")

  await page.getByLabel("Search equipment").fill("CRN 10-12")
  await expect(page.getByTestId("stat-items")).toHaveText("53")
  await expectGoodLayout(page, "equipment search results")

  // The headline numbers stay readable side by side.
  for (const name of ["items", "plants", "zones"]) {
    const box = (await page.getByTestId(`stat-${name}`).boundingBox())!
    expect(box.x, `stat-${name} on screen`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `stat-${name} on screen`).toBeLessThanOrEqual(page.viewportSize()!.width)
  }

  await page.getByRole("combobox", { name: /^Model filter/ }).click()
  await expect(page.getByRole("option").first()).toBeVisible()
  await expectGoodLayout(page, "model filter open")
  await page.getByRole("option", { name: /^CRN 10-12\b/ }).first().click()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("stat-items")).toHaveText("31")
  await expectGoodLayout(page, "model filter applied")

  // Zones can be picked by touch on a phone.
  const vadodara = page.getByTestId("zone-row-Vadodara")
  await vadodara.scrollIntoViewIfNeeded()
  const n = await page.getByTestId("zone-items-Vadodara").innerText()
  await vadodara.click()
  await expect(page.getByTestId("stat-items")).toHaveText(n)
  await expectGoodLayout(page, "zone selected")

  await page.getByRole("button", { name: /^Motors/ }).scrollIntoViewIfNeeded()
  await expectGoodLayout(page, "equipment kind chips")
})

// ====================================================================== document library
const WEB = { "X-PDM-Client": "web" }

async function editorRequest(request: APIRequestContext) {
  expect((await request.post("/api/auth/login", { data: creds("editor") })).ok()).toBeTruthy()
}

async function clearLibrary(request: APIRequestContext, id: number) {
  const docs = (await (await request.get(`/api/pdm/plants/${id}/documents`)).json()).items as { id: number }[]
  for (const d of docs) await request.delete(`/api/pdm/plants/${id}/documents/${d.id}`, { headers: WEB })
}

test.describe("document library", () => {
  let plant = 0
  test.beforeEach(async ({ request }) => {
    await editorRequest(request)
    plant = (await (await request.get("/api/pdm/plants/by-legacy-id/1")).json()).id
    await clearLibrary(request, plant)
    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n")
    for (const [name, title, category] of [
      ["RO skid PID.pdf", "RO skid P&ID", "pid"],
      // A long, unbroken file name and title must wrap or truncate, not widen the page.
      [
        "TORRENT_PHARMA_INDRAD_MEHSANA_2094_HPRO_400W_MCC_PANEL_GENERAL_ARRANGEMENT_AND_WIRING_REV_C_FINAL.pdf",
        "MCC panel general arrangement and wiring diagram, revision C (final, as built) for HPRO 400W",
        "electrical",
      ],
    ]) {
      const res = await request.post(`/api/pdm/plants/${plant}/documents`, {
        headers: WEB,
        multipart: { file: { name, mimeType: "application/pdf", buffer: pdf }, category, title, description: "Issued by Raybon" },
      })
      expect(res.status()).toBe(201)
    }
  })

  test.afterEach(async ({ request }) => {
    await editorRequest(request)
    await clearLibrary(request, plant)
  })

  test("the library, its dialogs and menus fit", async ({ page }) => {
    await login(page, "editor")
    await page.goto(`/plants/${plant}/documents`)
    await expect(page.getByRole("heading", { name: /Document library/ })).toBeVisible()
    await page.waitForLoadState("networkidle")
    await expectGoodLayout(page, "document library")

    // Each row's actions stay on screen, beside even the longest title.
    const W = page.viewportSize()!.width
    for (const name of [/^Download RO skid/, /^More actions for MCC panel/]) {
      const box = (await page.getByRole(name.source.startsWith("^Download") ? "link" : "button", { name }).last().boundingBox())!
      expect(box.x + box.width, `${name} on screen`).toBeLessThanOrEqual(W)
    }

    await page.getByRole("combobox", { name: "Category" }).click()
    await expectGoodLayout(page, "category filter open")
    await page.keyboard.press("Escape")

    await page.getByRole("button", { name: "Add document" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await dialog.locator("#document-file").setInputFiles({
      name: "A_VERY_LONG_FILE_NAME_FOR_THE_PLANT_LAYOUT_DRAWING_WITHOUT_ANY_SPACES_AT_ALL_REV_D.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    })
    await expectGoodLayout(page, "upload dialog with a file chosen")
    await dialog.getByRole("combobox", { name: "Category" }).click()
    await expectGoodLayout(page, "upload category list open")
    await page.keyboard.press("Escape")
    await dialog.getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: /^More actions for MCC panel/ }).click()
    await expectGoodLayout(page, "row menu open")
    await page.getByRole("menuitem", { name: "Edit details" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expectGoodLayout(page, "edit details dialog open")
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: /^More actions for MCC panel/ }).click()
    await page.getByRole("menuitem", { name: "Upload new revision" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expectGoodLayout(page, "revision dialog open")
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click()

    await page.getByRole("button", { name: /^More actions for MCC panel/ }).click()
    await page.getByRole("menuitem", { name: "Delete" }).click()
    await expect(page.getByRole("alertdialog")).toBeVisible()
    await expectGoodLayout(page, "delete confirmation open")
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click()
  })

  test("a document can be uploaded and downloaded on a phone", async ({ page }) => {
    await login(page, "editor")
    await page.goto(`/plants/${plant}/documents`)
    await page.getByRole("button", { name: "Add document" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.locator("#document-file").setInputFiles({
      name: "Site photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]),
    })
    await dialog.getByRole("combobox", { name: "Category" }).click()
    await page.getByRole("option", { name: "Site photo", exact: true }).click()
    // The submit button is reachable without the dialog running off screen.
    const upload = dialog.getByRole("button", { name: "Upload", exact: true })
    await upload.scrollIntoViewIfNeeded()
    await upload.click()
    await expect(page.getByRole("link", { name: "Download Site photo", exact: true })).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download Site photo", exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toBe("Site photo.jpg")
  })
})

test("empty document library fits", async ({ page, request }) => {
  await editorRequest(request)
  const id = await (await request.get("/api/pdm/plants/by-legacy-id/1071")).json().then((p) => p.id as number)
  await clearLibrary(request, id)
  await login(page, "viewer")
  await page.goto(`/plants/${id}/documents`)
  await expect(page.getByText("No documents yet")).toBeVisible()
  await expectGoodLayout(page, "empty library (viewer)")
})
