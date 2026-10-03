import { readFileSync } from "node:fs"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { creds, login, openPlant, plantId, type Role } from "./helpers"

/**
 * Plant document library (the "Documents" tab of a plant): viewing, uploading,
 * filing into categories, downloading, revising, re-filing, deleting, who may do
 * what, and how failures are reported. The last block exercises the Next.js BFF
 * proxy (/api/pdm/...) directly with binary uploads, since that is the path every
 * browser upload takes.
 *
 * Every test starts and ends with an empty library on the plant it uses.
 */

const LEGACY_ID = 1
const WEB = { "X-PDM-Client": "web" }

type Upload = { name: string; mimeType: string; buffer: Buffer }

/** A small but real PDF, so the browser could render a preview. */
function pdf(name: string, marker = "rev A"): Upload {
  const body = `%PDF-1.4\n1 0 obj <<>> endobj\n% ${marker}\ntrailer <<>>\n%%EOF\n`
  return { name, mimeType: "application/pdf", buffer: Buffer.from(body) }
}

/** Every byte value, then pseudo-random bytes: catches any text decoding on the way through. */
function binary(size: number, seed = 1): Buffer {
  const b = Buffer.alloc(size)
  let x = seed
  for (let i = 0; i < size; i++) {
    if (i < 256) b[i] = i
    else {
      x = (x * 1103515245 + 12345) & 0x7fffffff
      b[i] = x >> 16
    }
  }
  return b
}

async function signedInRequest(request: APIRequestContext, role: Role) {
  const res = await request.post("/api/auth/login", { data: creds(role) })
  expect(res.ok(), `sign in as ${role}`).toBeTruthy()
}

async function listDocs(request: APIRequestContext, id: number) {
  const res = await request.get(`/api/pdm/plants/${id}/documents`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as {
    items: { id: number; title: string; category: string; file_name: string; byte_size: number; sha256: string; updated_at: string; created_at: string }[]
    total: number
    counts: Record<string, number>
  }
}

async function clearLibrary(request: APIRequestContext, id: number) {
  for (const d of (await listDocs(request, id)).items) {
    const res = await request.delete(`/api/pdm/plants/${id}/documents/${d.id}`, { headers: WEB })
    expect(res.status()).toBe(204)
  }
}

/** Upload through the proxy, as the signed-in user of `request`. */
function apiUpload(request: APIRequestContext, id: number, file: Upload, fields: Record<string, string> = {}) {
  return request.post(`/api/pdm/plants/${id}/documents`, {
    headers: WEB,
    multipart: { file, category: "pid", title: file.name.replace(/\.[^.]+$/, ""), ...fields },
  })
}

let plant = 0

test.beforeAll(async ({ request }) => {
  await signedInRequest(request, "editor")
  const res = await request.get(`/api/pdm/plants/by-legacy-id/${LEGACY_ID}`)
  plant = (await res.json()).id
  await clearLibrary(request, plant)
})

test.afterEach(async ({ request }) => {
  await signedInRequest(request, "editor")
  await clearLibrary(request, plant)
})

async function openDocuments(page: Page) {
  await openPlant(page, LEGACY_ID, "/documents")
  await expect(page.getByRole("heading", { name: /Document library/ })).toBeVisible()
}

function library(page: Page) {
  return page.locator("ul").filter({ has: page.getByRole("link", { name: /^Download / }) })
}

function row(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("link", { name: `Download ${title}`, exact: true }) })
}

async function rowAction(page: Page, title: string, action: "Upload new revision" | "Edit details" | "Delete") {
  await page.getByRole("button", { name: `More actions for ${title}` }).click()
  await page.getByRole("menuitem", { name: action }).click()
}

/**
 * The most recent change set on the plant's History tab. History outlives the
 * documents it describes, so earlier runs' entries may be further down.
 */
async function latestChange(page: Page) {
  await page.getByRole("link", { name: "History" }).click()
  return page.getByRole("main").getByRole("listitem").filter({ has: page.locator("time") }).first()
}

async function chooseOption(page: Page, scope: ReturnType<Page["getByRole"]> | Page, combobox: string, option: string) {
  await scope.getByRole("combobox", { name: combobox }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}

// ====================================================================== viewing
test.describe("viewing", () => {
  test("the Documents tab is reachable from the plant page and starts empty", async ({ page }) => {
    await login(page, "viewer")
    await openPlant(page, LEGACY_ID)
    await page.getByRole("link", { name: /^Documents/ }).click()
    await expect(page).toHaveURL(/\/plants\/\d+\/documents$/)
    await expect(page.getByText("No documents yet")).toBeVisible()
    // A viewer is told who can add documents, and is not offered the button.
    await expect(page.getByText("Ask an editor to add its drawings and manuals")).toBeVisible()
    await expect(page.getByRole("button", { name: /Add document|Add the first document/ })).toHaveCount(0)
  })

  test("a viewer sees every document with its category, size, uploader and notes", async ({ page, request }) => {
    await signedInRequest(request, "editor")
    expect((await apiUpload(request, plant, pdf("RO skid PID.pdf"), { title: "RO skid P&ID", description: "Rev A from Raybon" })).ok()).toBeTruthy()
    expect((await apiUpload(request, plant, { name: "MCC.dwg", mimeType: "application/octet-stream", buffer: binary(4096) }, { category: "electrical", title: "MCC panel" })).ok()).toBeTruthy()

    await login(page, "viewer")
    await openDocuments(page)
    await expect(library(page).getByRole("listitem")).toHaveCount(2)
    const pid = row(page, "RO skid P&ID")
    await expect(pid.getByText("P&ID", { exact: true })).toBeVisible()
    await expect(pid.getByText("RO skid PID.pdf")).toBeVisible()
    await expect(pid.getByText("Rev A from Raybon")).toBeVisible()
    await expect(pid.getByText(creds("editor").username, { exact: false })).toBeVisible()
    const mcc = row(page, "MCC panel")
    await expect(mcc.getByText("Electrical drawing", { exact: true })).toBeVisible()
    await expect(mcc.getByText("4 kB")).toBeVisible()
    // The tab and the library header both carry the count.
    await expect(page.getByRole("link", { name: /^Documents/ })).toContainText("2")
    await expect(page.getByRole("heading", { name: /Document library/ })).toContainText("2")
    // Viewers can read but not change anything.
    await expect(page.getByRole("button", { name: /^More actions for/ })).toHaveCount(0)
  })
})

// ====================================================================== uploading
test.describe("uploading", () => {
  test("an editor uploads a document, filed under the category they choose", async ({ page }) => {
    await login(page, "editor")
    await openDocuments(page)
    await page.getByRole("button", { name: "Add the first document" }).click()
    const dialog = page.getByRole("dialog", { name: "Add a document" })
    await expect(dialog).toBeVisible()

    await dialog.locator("#document-file").setInputFiles(pdf("Main panel wiring.pdf"))
    await expect(dialog.getByText("Main panel wiring.pdf")).toBeVisible()
    // The file name is offered as the title.
    await expect(dialog.getByLabel("Title")).toHaveValue("Main panel wiring")
    await chooseOption(page, dialog, "Category", "Electrical drawing")
    await dialog.getByLabel("Title").fill("Main panel wiring — Rev B")
    await dialog.getByLabel(/Notes/).fill("Issued by site electrician")
    await dialog.getByLabel("Reason for change").fill("Initial upload")
    await dialog.getByRole("button", { name: "Upload", exact: true }).click()

    await expect(page.getByText("Document uploaded")).toBeVisible()
    await expect(dialog).toBeHidden()
    const r = row(page, "Main panel wiring — Rev B")
    await expect(r.getByText("Electrical drawing", { exact: true })).toBeVisible()
    await expect(r.getByText("Issued by site electrician")).toBeVisible()
    await expect(page.getByRole("link", { name: /^Documents/ })).toContainText("1")

    // Stored as uploaded, under the plant.
    const docs = await listDocs(page.request, plant)
    expect(docs.items).toHaveLength(1)
    expect(docs.items[0]).toMatchObject({ category: "electrical", file_name: "Main panel wiring.pdf", title: "Main panel wiring — Rev B" })
  })

  test("the upload is recorded in the plant's history, with the reason", async ({ page }) => {
    await login(page, "editor")
    await openDocuments(page)
    await page.getByRole("button", { name: "Add the first document" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.locator("#document-file").setInputFiles(pdf("Layout.pdf"))
    await chooseOption(page, dialog, "Category", "Plant layout")
    await dialog.getByLabel("Reason for change").fill("Layout from commissioning file")
    await dialog.getByRole("button", { name: "Upload", exact: true }).click()
    await expect(page.getByText("Document uploaded")).toBeVisible()

    const change = await latestChange(page)
    await expect(change.getByText("Added document in Documents: Layout")).toBeVisible()
    await expect(change.getByText("Layout from commissioning file")).toBeVisible()
    await expect(change.getByText("Plant layout", { exact: true })).toBeVisible()
  })

  test("a file can be dropped onto the upload area", async ({ page }) => {
    await login(page, "editor")
    await openDocuments(page)
    await page.getByRole("button", { name: "Add document" }).click()
    const dialog = page.getByRole("dialog")
    const drop = dialog.getByText("or drag it here").locator("..")
    const transfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(["%PDF-1.4\n%%EOF\n"], "Dropped manual.pdf", { type: "application/pdf" }))
      return dt
    })
    await drop.dispatchEvent("drop", { dataTransfer: transfer })
    await expect(dialog.getByText("Dropped manual.pdf")).toBeVisible()
    await expect(dialog.getByLabel("Title")).toHaveValue("Dropped manual")
  })
})

// ====================================================================== categories and search
test.describe("categories and search", () => {
  test.beforeEach(async ({ request }) => {
    await signedInRequest(request, "editor")
    for (const [name, category] of [
      ["Overall PID.pdf", "pid"],
      ["RO PID.pdf", "pid"],
      ["MCC wiring.pdf", "electrical"],
      ["Pump manual.pdf", "manual"],
    ]) {
      expect((await apiUpload(request, plant, pdf(name), { category })).ok()).toBeTruthy()
    }
  })

  test("filtering by category shows per-category counts", async ({ page }) => {
    await login(page, "viewer")
    await openDocuments(page)
    await expect(library(page).getByRole("listitem")).toHaveCount(4)

    await page.getByRole("combobox", { name: "Category" }).click()
    await expect(page.getByRole("option", { name: "All categories (4)" })).toBeVisible()
    await expect(page.getByRole("option", { name: "P&ID (2)" })).toBeVisible()
    await expect(page.getByRole("option", { name: "Electrical drawing (1)" })).toBeVisible()
    // Empty categories are listed, but cannot be picked.
    await expect(page.getByRole("option", { name: "Certificate (0)" })).toBeDisabled()
    await page.getByRole("option", { name: "P&ID (2)" }).click()

    await expect(library(page).getByRole("listitem")).toHaveCount(2)
    await expect(row(page, "Overall PID")).toBeVisible()
    await expect(row(page, "RO PID")).toBeVisible()
    await expect(row(page, "MCC wiring")).toHaveCount(0)
    // Counts still cover the whole library while a category is selected.
    await page.getByRole("combobox", { name: "Category" }).click()
    await expect(page.getByRole("option", { name: "Manual / O&M (1)" })).toBeVisible()
    await page.keyboard.press("Escape")
  })

  test("searching matches title and file name, and an empty result can be cleared", async ({ page }) => {
    await login(page, "viewer")
    await openDocuments(page)
    await page.getByLabel("Search documents").fill("wiring")
    await expect(library(page).getByRole("listitem")).toHaveCount(1)
    await expect(row(page, "MCC wiring")).toBeVisible()

    await page.getByLabel("Search documents").fill("no-such-drawing")
    await expect(page.getByText("No documents match")).toBeVisible()
    await page.getByRole("button", { name: "Clear filters" }).click()
    await expect(page.getByLabel("Search documents")).toHaveValue("")
    await expect(library(page).getByRole("listitem")).toHaveCount(4)
  })

  test("uploading from a filtered view defaults to that category", async ({ page }) => {
    await login(page, "editor")
    await openDocuments(page)
    await chooseOption(page, page, "Category", "Manual / O&M (1)")
    await page.getByRole("button", { name: "Add document" }).click()
    await expect(page.getByRole("dialog").getByRole("combobox", { name: "Category" })).toHaveText("Manual / O&M")
  })

  test("a document can be re-filed and renamed without re-uploading it", async ({ page }) => {
    await login(page, "editor")
    await openDocuments(page)
    const before = (await listDocs(page.request, plant)).items.find((d) => d.title === "Pump manual")!

    await rowAction(page, "Pump manual", "Edit details")
    const dialog = page.getByRole("dialog", { name: "Edit document details" })
    await chooseOption(page, dialog, "Category", "Datasheet")
    await dialog.getByLabel("Title").fill("CRN 10-12 datasheet")
    await dialog.getByLabel(/Notes/).fill("Grundfos curve")
    await dialog.getByLabel("Reason for change").fill("Wrongly filed as a manual")
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Document updated")).toBeVisible()

    const r = row(page, "CRN 10-12 datasheet")
    await expect(r.getByText("Datasheet", { exact: true })).toBeVisible()
    await expect(r.getByText("Pump manual.pdf")).toBeVisible() // the file is untouched
    const after = (await listDocs(page.request, plant)).items.find((d) => d.id === before.id)!
    expect(after).toMatchObject({ category: "datasheet", sha256: before.sha256 })

    const change = await latestChange(page)
    await expect(change.getByText("Wrongly filed as a manual")).toBeVisible()
    // Category changes read as labels, not internal keys.
    await expect(change.getByRole("listitem").filter({ hasText: /^Documents › .+ · Category\s*Manual \/ O&M\s*Datasheet$/ })).toBeVisible()
  })
})

// ====================================================================== downloading
test.describe("downloading", () => {
  test("a viewer downloads the exact bytes that were uploaded, under the original name", async ({ page, request }) => {
    const bytes = binary(200_000, 7)
    await signedInRequest(request, "editor")
    expect((await apiUpload(request, plant, { name: "Motor curves.xlsx", mimeType: "text/html", buffer: bytes }, { category: "datasheet", title: "Motor curves" })).ok()).toBeTruthy()

    await login(page, "viewer")
    await openDocuments(page)
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download Motor curves" }).click(),
    ])
    expect(download.suggestedFilename()).toBe("Motor curves.xlsx")
    expect(readFileSync(await download.path()).equals(bytes)).toBe(true)
  })

  test("PDFs and images can be opened in the browser; other formats only download", async ({ page, request }) => {
    await signedInRequest(request, "editor")
    await apiUpload(request, plant, pdf("Viewable.pdf"))
    await apiUpload(request, plant, { name: "Drawing.dwg", mimeType: "application/octet-stream", buffer: binary(1000) })

    await login(page, "viewer")
    await openDocuments(page)
    const open = page.getByRole("link", { name: "Open Viewable in a new tab" })
    await expect(open).toHaveAttribute("target", "_blank")
    await expect(open).toHaveAttribute("href", /\/content\?inline=true$/)
    await expect(page.getByRole("link", { name: "Open Drawing in a new tab" })).toHaveCount(0)

    // The preview is served inline; a forced inline request for a DWG still downloads.
    const docs = (await listDocs(page.request, plant)).items
    const viewable = docs.find((d) => d.title === "Viewable")!
    const drawing = docs.find((d) => d.title === "Drawing")!
    const inline = await page.request.get(`/api/pdm/plants/${plant}/documents/${viewable.id}/content?inline=true`)
    expect(inline.headers()["content-disposition"]).toMatch(/^inline;/)
    const forced = await page.request.get(`/api/pdm/plants/${plant}/documents/${drawing.id}/content?inline=true`)
    expect(forced.headers()["content-disposition"]).toMatch(/^attachment;/)
  })
})

// ====================================================================== revising
test.describe("revising", () => {
  test("uploading a new revision replaces the file but keeps the document", async ({ page, request }) => {
    await signedInRequest(request, "editor")
    await apiUpload(request, plant, pdf("Overall PID.pdf", "rev A"), { title: "Overall P&ID" })
    const original = (await listDocs(request, plant)).items[0]

    await login(page, "editor")
    await openDocuments(page)
    await rowAction(page, "Overall P&ID", "Upload new revision")
    const dialog = page.getByRole("dialog", { name: "Upload a new revision" })
    // The category is fixed: a revision stays where the document is filed.
    await expect(dialog.getByRole("combobox", { name: "Category" })).toBeDisabled()
    await expect(dialog.getByLabel("Title")).toHaveValue("Overall P&ID")
    const revB = pdf("Overall PID.pdf", "rev B — with new dosing line")
    await dialog.locator("#document-file").setInputFiles(revB)
    await expect(dialog.getByText("The current file will be replaced.")).toBeVisible()
    await dialog.getByLabel("Title").fill("Overall P&ID — Rev B")
    await dialog.getByLabel("Reason for change").fill("Dosing line added")
    await dialog.getByRole("button", { name: "Upload revision" }).click()
    await expect(page.getByText("Document uploaded")).toBeVisible()

    await expect(library(page).getByRole("listitem")).toHaveCount(1)
    await expect(row(page, "Overall P&ID — Rev B").getByText(/^revised /)).toBeVisible()
    const after = (await listDocs(page.request, plant)).items
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(original.id)
    expect(after[0].sha256).not.toBe(original.sha256)
    expect(after[0].byte_size).toBe(revB.buffer.length)

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Download Overall P&ID — Rev B" }).click(),
    ])
    expect(readFileSync(await download.path()).equals(revB.buffer)).toBe(true)

    const change = await latestChange(page)
    await expect(change.getByText("Dosing line added")).toBeVisible()
    // A revision shows as a new file checksum and size on the same document, not as a new document.
    await expect(change.getByRole("listitem").filter({ hasText: /^Documents › Overall P&ID · File checksum\s*[0-9a-f]{64}\s*[0-9a-f]{64}$/ })).toBeVisible()
    await expect(change.getByRole("listitem").filter({ hasText: new RegExp(`Size \\(bytes\\)\\s*${original.byte_size}\\s*${revB.buffer.length}$`) })).toBeVisible()
    await expect(change.getByText(/^Added document/)).toHaveCount(0)
  })

  test("adding a file whose name is already filed warns that it will be a revision", async ({ page, request }) => {
    await signedInRequest(request, "editor")
    await apiUpload(request, plant, pdf("Manual.pdf"), { category: "manual", title: "O&M manual" })

    await login(page, "editor")
    await openDocuments(page)
    await page.getByRole("button", { name: "Add document" }).click()
    const dialog = page.getByRole("dialog", { name: "Add a document" })
    await dialog.locator("#document-file").setInputFiles(pdf("manual.PDF", "v2"))
    // Same name in another category is a different document…
    await expect(dialog.getByRole("button", { name: "Upload", exact: true })).toBeVisible()
    // …in the same category it is a revision, matched regardless of case.
    await chooseOption(page, dialog, "Category", "Manual / O&M")
    await expect(dialog.getByText(/“Manual\.pdf” is already filed under Manual \/ O&M/)).toBeVisible()
    await dialog.getByRole("button", { name: "Upload revision" }).click()
    await expect(page.getByText("Document uploaded")).toBeVisible()
    await expect(library(page).getByRole("listitem")).toHaveCount(1)
  })
})

// ====================================================================== deleting
test.describe("deleting", () => {
  test("deleting asks for confirmation, removes the file and is recorded", async ({ page, request }) => {
    await signedInRequest(request, "editor")
    await apiUpload(request, plant, pdf("Old layout.pdf"), { category: "layout", title: "Old layout" })
    await apiUpload(request, plant, pdf("Keep.pdf"), { title: "Keep me" })
    const doomed = (await listDocs(request, plant)).items.find((d) => d.title === "Old layout")!

    await login(page, "editor")
    await openDocuments(page)
    await rowAction(page, "Old layout", "Delete")
    const confirm = page.getByRole("alertdialog", { name: "Delete this document?" })
    await expect(confirm.getByText("Old layout.pdf")).toBeVisible()
    // Cancelling keeps it.
    await confirm.getByRole("button", { name: "Cancel" }).click()
    await expect(row(page, "Old layout")).toBeVisible()

    await rowAction(page, "Old layout", "Delete")
    await confirm.getByLabel("Reason for change").fill("Superseded by new layout")
    await confirm.getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("Document deleted")).toBeVisible()
    await expect(row(page, "Old layout")).toHaveCount(0)
    await expect(row(page, "Keep me")).toBeVisible()
    await expect(page.getByRole("link", { name: /^Documents/ })).toContainText("1")

    // The file is gone, not just hidden.
    const gone = await page.request.get(`/api/pdm/plants/${plant}/documents/${doomed.id}/content`)
    expect(gone.status()).toBe(404)

    const change = await latestChange(page)
    await expect(change.getByText("Removed document in Documents: Old layout")).toBeVisible()
    await expect(change.getByText("Superseded by new layout")).toBeVisible()
  })
})

// ====================================================================== permissions
test.describe("permissions", () => {
  test("a viewer cannot upload, edit or delete, even by calling the API", async ({ page, request }) => {
    await signedInRequest(request, "editor")
    await apiUpload(request, plant, pdf("Locked.pdf"), { title: "Locked" })
    const doc = (await listDocs(request, plant)).items[0]

    await login(page, "viewer")
    await openDocuments(page)
    await expect(row(page, "Locked")).toBeVisible()
    await expect(page.getByRole("button", { name: "Add document" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "More actions for Locked" })).toHaveCount(0)

    expect((await apiUpload(page.request, plant, pdf("Sneaky.pdf"))).status()).toBe(403)
    const patch = await page.request.patch(`/api/pdm/plants/${plant}/documents/${doc.id}`, { headers: WEB, data: { title: "Hacked" } })
    expect(patch.status()).toBe(403)
    const del = await page.request.delete(`/api/pdm/plants/${plant}/documents/${doc.id}`, { headers: WEB })
    expect(del.status()).toBe(403)
    expect((await listDocs(page.request, plant)).items).toMatchObject([{ id: doc.id, title: "Locked" }])
  })

  test("an admin can manage documents too", async ({ page }) => {
    await login(page, "admin")
    await openDocuments(page)
    await page.getByRole("button", { name: "Add the first document" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.locator("#document-file").setInputFiles(pdf("Certificate.pdf"))
    await chooseOption(page, dialog, "Category", "Certificate")
    await dialog.getByRole("button", { name: "Upload", exact: true }).click()
    await expect(row(page, "Certificate")).toBeVisible()
    await rowAction(page, "Certificate", "Delete")
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click()
    await expect(page.getByText("No documents yet")).toBeVisible()
  })

  test("signed-out visitors cannot list or download documents", async ({ page, request }) => {
    await signedInRequest(request, "editor")
    await apiUpload(request, plant, pdf("Private.pdf"))
    const doc = (await listDocs(request, plant)).items[0]

    // `page` has no session cookie.
    expect((await page.request.get(`/api/pdm/plants/${plant}/documents`)).status()).toBe(401)
    expect((await page.request.get(`/api/pdm/plants/${plant}/documents/${doc.id}/content`)).status()).toBe(401)
    await page.goto(`/plants/${plant}/documents`)
    await expect(page).toHaveURL(/\/login\?next=/)
  })
})

// ====================================================================== error handling
test.describe("error handling", () => {
  test("files the server would refuse are caught in the form, before uploading", async ({ page }) => {
    await login(page, "editor")
    await openDocuments(page)
    await page.getByRole("button", { name: "Add the first document" }).click()
    const dialog = page.getByRole("dialog")
    const upload = dialog.getByRole("button", { name: "Upload", exact: true })
    const file = dialog.locator("#document-file")

    await file.setInputFiles({ name: "setup.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") })
    await expect(dialog.getByText(/“\.exe” files are not accepted/)).toBeVisible()
    await expect(upload).toBeDisabled()

    await file.setInputFiles({ name: "page.html", mimeType: "text/html", buffer: Buffer.from("<script>alert(1)</script>") })
    await expect(dialog.getByText(/“\.html” files are not accepted/)).toBeVisible()
    await expect(upload).toBeDisabled()

    await file.setInputFiles({ name: "README", mimeType: "text/plain", buffer: Buffer.from("x") })
    await expect(dialog.getByText("The file needs an extension so its type can be recognised.")).toBeVisible()

    await file.setInputFiles({ name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) })
    await expect(dialog.getByText("The file is empty.")).toBeVisible()
    await expect(upload).toBeDisabled()

    await file.setInputFiles({ name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(26 * 1024 * 1024, 1) })
    await expect(dialog.getByText(/the limit is 25(\.0)? MB/)).toBeVisible()
    await expect(upload).toBeDisabled()

    // A good file clears the problem.
    await file.setInputFiles(pdf("fine.pdf"))
    await expect(upload).toBeEnabled()
    // A title is required.
    await dialog.getByLabel("Title").fill("  ")
    await expect(upload).toBeDisabled()
  })

  test("a server-side rejection is reported and the form keeps what was entered", async ({ page }) => {
    await login(page, "editor")
    await openDocuments(page)
    await page.route(`**/api/pdm/plants/${plant}/documents`, (r) =>
      r.request().method() === "POST"
        ? r.fulfill({ status: 413, contentType: "application/json", body: '{"detail":"The file is larger than the 25 MB limit"}' })
        : r.fallback(),
    )
    await page.getByRole("button", { name: "Add the first document" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.locator("#document-file").setInputFiles(pdf("Rejected.pdf"))
    await dialog.getByLabel("Title").fill("Will be rejected")
    await dialog.getByRole("button", { name: "Upload", exact: true }).click()

    await expect(page.getByText("Upload failed")).toBeVisible()
    await expect(page.getByText("The file is larger than the 25 MB limit")).toBeVisible()
    // Nothing lost: the dialog stays open with the same file and title, ready to retry.
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("Rejected.pdf")).toBeVisible()
    await expect(dialog.getByLabel("Title")).toHaveValue("Will be rejected")

    await page.unroute(`**/api/pdm/plants/${plant}/documents`)
    await dialog.getByRole("button", { name: "Upload", exact: true }).click()
    await expect(row(page, "Will be rejected")).toBeVisible()
  })

  test("the API refuses dangerous or duplicate uploads through the proxy", async ({ page }) => {
    await login(page, "editor")
    const html = await apiUpload(page.request, plant, { name: "x.html", mimeType: "application/pdf", buffer: Buffer.from("<script>") })
    expect(html.status()).toBe(422)
    expect((await html.json()).detail).toMatch(/'\.html' files are not accepted/)
    const svg = await apiUpload(page.request, plant, { name: "x.svg", mimeType: "image/png", buffer: Buffer.from("<svg/>") })
    expect(svg.status()).toBe(422)
    const badCategory = await apiUpload(page.request, plant, pdf("x.pdf"), { category: "secret" })
    expect(badCategory.status()).toBe(422)

    expect((await apiUpload(page.request, plant, pdf("Dup.pdf"))).status()).toBe(201)
    const dup = await apiUpload(page.request, plant, pdf("dup.pdf"))
    expect(dup.status()).toBe(409)
    expect((await dup.json()).detail).toMatch(/replace=true/)
  })

  test("an edit based on a stale copy is refused, not silently overwritten", async ({ page, request }) => {
    await signedInRequest(request, "editor")
    await apiUpload(request, plant, pdf("Shared.pdf"), { title: "Shared" })
    const doc = (await listDocs(request, plant)).items[0]

    await login(page, "editor")
    await openDocuments(page)
    await rowAction(page, "Shared", "Edit details")
    // Someone else renames it meanwhile.
    const other = await request.patch(`/api/pdm/plants/${plant}/documents/${doc.id}`, {
      headers: WEB,
      data: { title: "Shared (renamed elsewhere)", expected_updated_at: doc.updated_at },
    })
    expect(other.ok()).toBeTruthy()

    const dialog = page.getByRole("dialog", { name: "Edit document details" })
    await dialog.getByLabel("Title").fill("My rename")
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Someone else changed this document")).toBeVisible()
    // The form closes and the library shows the other person's change; nothing was overwritten.
    await expect(dialog).toBeHidden()
    await expect(row(page, "Shared (renamed elsewhere)")).toBeVisible()
    expect((await listDocs(page.request, plant)).items[0].title).toBe("Shared (renamed elsewhere)")
    // Editing again starts from the latest copy and succeeds.
    await rowAction(page, "Shared (renamed elsewhere)", "Edit details")
    await expect(dialog.getByLabel("Title")).toHaveValue("Shared (renamed elsewhere)")
    await dialog.getByLabel("Title").fill("My rename")
    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(row(page, "My rename")).toBeVisible()
  })

  test("a library that fails to load shows an error with retry", async ({ page }) => {
    await login(page, "viewer")
    await page.route(`**/api/pdm/plants/*/documents*`, (r) =>
      r.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"The Plant Data API is unavailable"}' }),
    )
    await openPlant(page, LEGACY_ID, "/documents")
    await expect(page.getByText("The Plant Data API is unavailable")).toBeVisible({ timeout: 15_000 })
    await page.unroute(`**/api/pdm/plants/*/documents*`)
    await page.getByRole("button", { name: "Try again" }).click()
    await expect(page.getByText("No documents yet")).toBeVisible()
  })

  test("documents of another plant cannot be reached through this plant's URL", async ({ page, request }) => {
    await signedInRequest(request, "editor")
    await apiUpload(request, plant, pdf("Mine.pdf"))
    const doc = (await listDocs(request, plant)).items[0]

    await login(page, "editor")
    const other = await plantId(page, 1071)
    expect((await page.request.get(`/api/pdm/plants/${other}/documents/${doc.id}/content`)).status()).toBe(404)
    const del = await page.request.delete(`/api/pdm/plants/${other}/documents/${doc.id}`, { headers: WEB })
    expect(del.status()).toBe(404)
    expect((await listDocs(page.request, plant)).total).toBe(1)
  })
})

// ====================================================================== BFF proxy
test.describe("uploads through the Next.js proxy", () => {
  test.beforeEach(async ({ request }) => {
    await signedInRequest(request, "editor")
  })

  async function roundTrip(request: APIRequestContext, file: Upload) {
    const res = await apiUpload(request, plant, file)
    expect(res.status(), await res.text()).toBe(201)
    const doc = await res.json()
    expect(doc.byte_size).toBe(file.buffer.length)
    const back = await request.get(`/api/pdm/plants/${plant}/documents/${doc.id}/content`)
    expect(back.status()).toBe(200)
    expect((await back.body()).equals(file.buffer)).toBe(true)
    return { doc, back }
  }

  test("binary content survives the proxy byte for byte", async ({ request }) => {
    const { doc, back } = await roundTrip(request, { name: "bytes.dwg", mimeType: "application/octet-stream", buffer: binary(64 * 1024) })
    const crypto = await import("node:crypto")
    expect(doc.sha256).toBe(crypto.createHash("sha256").update(binary(64 * 1024)).digest("hex"))
    const h = back.headers()
    expect(h["content-type"]).toBe("image/vnd.dwg") // from the extension, never the browser's claim
    expect(h["content-length"]).toBe(String(64 * 1024))
    expect(h["content-disposition"]).toMatch(/^attachment; filename="bytes\.dwg"/)
    expect(h["x-content-type-options"]).toBe("nosniff")
    expect(h["etag"]).toBe(`"${doc.sha256}"`)
  })

  test("a large (15 MB) drawing is not truncated or buffered away", async ({ request }) => {
    await roundTrip(request, { name: "large.tif", mimeType: "image/tiff", buffer: binary(15 * 1024 * 1024, 3) })
  })

  test("a file just under the 25 MB limit is accepted; one over it is refused", async ({ request }) => {
    await roundTrip(request, { name: "edge.zip", mimeType: "application/zip", buffer: binary(25 * 1024 * 1024 - 1024, 5) })
    const over = await apiUpload(request, plant, { name: "over.zip", mimeType: "application/zip", buffer: binary(25 * 1024 * 1024 + 1, 9) })
    expect(over.status()).toBe(413)
    expect((await over.json()).detail).toMatch(/25 MB limit/)
  })

  test("non-ASCII file names, titles and notes come back intact", async ({ request }) => {
    const res = await apiUpload(request, plant, pdf("Anlagenplan Übersicht – Zone 2.pdf"), {
      title: "Anlagenplan Übersicht – Zone 2 (संयंत्र)",
      description: "Ändert die Dosierleitung • rev ③",
    })
    expect(res.status()).toBe(201)
    const doc = await res.json()
    expect(doc.file_name).toBe("Anlagenplan Übersicht – Zone 2.pdf")
    expect(doc.title).toBe("Anlagenplan Übersicht – Zone 2 (संयंत्र)")
    expect(doc.description).toBe("Ändert die Dosierleitung • rev ③")
    const back = await request.get(`/api/pdm/plants/${plant}/documents/${doc.id}/content`)
    expect(back.headers()["content-disposition"]).toContain("filename*=UTF-8''Anlagenplan%20%C3%9Cbersicht")
  })

  test("a revision through the proxy replaces the stored bytes", async ({ request }) => {
    const first = await roundTrip(request, { name: "rev.pdf", mimeType: "application/pdf", buffer: binary(10_000, 11) })
    const second = binary(20_000, 12)
    const res = await apiUpload(request, plant, { name: "rev.pdf", mimeType: "application/pdf", buffer: second }, { replace: "true" })
    expect(res.status()).toBe(201)
    expect((await res.json()).id).toBe(first.doc.id)
    const back = await request.get(`/api/pdm/plants/${plant}/documents/${first.doc.id}/content`)
    expect((await back.body()).equals(second)).toBe(true)
  })

  test("uploads need the CSRF header and a session", async ({ request, playwright }) => {
    const noHeader = await request.post(`/api/pdm/plants/${plant}/documents`, {
      multipart: { file: pdf("csrf.pdf"), category: "pid", title: "csrf" },
    })
    expect(noHeader.status()).toBe(403)
    expect((await noHeader.json()).detail).toBe("Missing X-PDM-Client header")

    const anon = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL })
    const res = await apiUpload(anon, plant, pdf("anon.pdf"))
    expect(res.status()).toBe(401)
    await anon.dispose()
    expect((await listDocs(request, plant)).total).toBe(0)
  })
})
