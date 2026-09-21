import { expect, test, type Page } from "@playwright/test"

import { login, plantId, startEditing } from "./helpers"

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
