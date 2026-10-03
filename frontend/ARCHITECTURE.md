# Plant Data — Frontend

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · shadcn/ui (Radix) · Lucide · TanStack Query · dnd-kit.

```
Browser ──► Next.js (this app) ──► FastAPI (api/) ──► PostgreSQL
            /api/pdm/* proxy          the only data source
```

The browser never talks to FastAPI or PostgreSQL directly.

## Running

```bash
cp .env.example .env.local        # PDM_API_URL=http://127.0.0.1:8000
npm install
npm run dev                       # or: npm run build && npm start
```

The API must be running (see `../api/API.md`) with migrations `001_user_accounts.sql` and
`002_documents_and_equipment_search.sql` applied.
Sign in with a username and password. Admins manage accounts on the **Users** page. Create the first
admin with `python ../api/tools/create_user.py <username> --role admin`.

## Structure

```
src/
├── proxy.ts                        redirect visitors without a session to /login
├── app/
│   ├── login/                      username/password sign-in (replaceable by SSO)
│   ├── api/auth/{login,logout}     create / end the session (httpOnly cookie)
│   ├── api/pdm/[...path]           authenticated proxy to FastAPI
│   └── (app)/                      authenticated area (layout validates the session via GET /me)
│       ├── page.tsx                dashboard
│       ├── plants/                 list + search
│       ├── equipment/              cross-plant equipment search (make / model / type, by zone)
│       ├── users/                  user & role administration (admin)
│       └── plants/[id]/            detail frame (sticky header, tabs)
│           ├── page.tsx            plant data (all sections, editing)
│           ├── documents/          plant document library
│           ├── history/            audit history
│           └── legacy/             read-only legacy source
├── components/
│   ├── shell/                      sidebar, ⌘K plant switcher, user menu
│   ├── plant/                      section cards, table sections, grouped sections, editing primitives
│   ├── equipment/                  search form, zone breakdown, per-plant results
│   ├── documents/                  library list, upload / revision dialog
│   ├── history/describe.ts         change_log rows -> readable change sets
│   ├── legacy/                     provenance, reconciliation, original record
│   └── common/                     value rendering, states (loading/empty/error), facet multi-select
└── lib/
    ├── api/{types,client,hooks}.ts typed API client + TanStack Query hooks
    ├── auth/session.ts             server-side credential storage (SSO swap point)
    ├── auth/session-context.tsx    current user + role checks in the UI
    ├── sections.ts                 section definitions, legacy terminology, columns
    ├── equipment.ts                equipment-kind icons and order, byte formatting
    └── values.ts                   display helpers (never rewrite values)
```

## Key decisions

- **BFF proxy.** `/api/pdm/*` adds `Authorization: Bearer <token>` from an httpOnly, SameSite=Lax cookie.
  - Only four request headers are forwarded (`Content-Type`, `Content-Length`, `X-Change-Reason`,
    `X-Request-ID`).
  - Request and response bodies are **streamed**, not read into memory (`duplex: "half"`), so binary
    uploads arrive byte for byte and large drawings never sit in the Next.js process.
    `proxy.ts` does not match `/api/*`, so Next.js does not buffer or cap these bodies either.
  - Responses keep `Content-Disposition`, `ETag`, `Cache-Control` and `X-Content-Type-Options`, so
    downloads keep their file name and the API's nosniff/attachment rules reach the browser.
  - Path segments are whitelisted.
  - Writes must carry `X-PDM-Client: web` as CSRF protection.
  - This also means the API needs no CORS configuration.
- **Replacing authentication with SSO.** Only `lib/auth/session.ts` and `app/api/auth/*` read the credential.
  - With OIDC, store the SSO session there, return its access token from `getAccessToken()`, and swap the
    login form for a "Sign in with …" button.
  - Pages, components and role checks stay the same: roles come from `GET /me`.
- **Roles.** `useSession().can("edit" | "admin")` mirrors the API's role ranks. Controls the user can't
  use are hidden, and the API still enforces every rule.
- **Every write** goes through `usePlantWrite`, which:
  - sends the change reason;
  - shows a toast;
  - refreshes the plant, its history and the list views.
  - Edits send `expected_updated_at`. On 409 the user is told someone else changed the record, and the
    fresh data loads.
- **Equipment search** (`/equipment`, in the sidebar). One page answers "how many plants have this
  pump model, across all zones and per zone":
  - Every filter lives in the URL (`?q=CRN+10-12&zone_id=6&zone_id=2&model=…&kind=pumps`), so a result
    can be shared or bookmarked. The search box is debounced (300 ms) and uses `router.replace`.
  - Make / Model / Type are multi-select facets that show how many items and plants each value has.
    The zone list is clickable, multi-select, and keeps showing every zone's count after one is
    picked (the API's facets ignore their own filter). Zones with no matches show 0 and are disabled.
  - Each match links to its plant; labels and which lists exist come from `GET /equipment/kinds`.
- **Document library** (plant → **Documents** tab, with a count badge).
  - Upload by file picker or drag and drop; the file name is offered as the title. The form checks
    extension, emptiness and size against `GET /document-categories` before sending, with the
    API's own wording. A server refusal is shown as a toast and the form keeps its contents.
  - A file whose name is already filed in that category is uploaded as a revision (`replace=true`),
    with a warning first. "Upload new revision" on a row does the same, with the category fixed.
  - Uploads go through `usePlantDocumentWrite` as `FormData` (the browser sets the multipart
    boundary). Download and preview are plain links to the proxy: the session cookie authenticates
    them, so the browser streams the file itself.
  - Re-filing / renaming sends `expected_updated_at`; on 409 the dialog closes and the library reloads.
  - Every change appears on the plant's History tab ("Documents"), with the reason.
  - Viewers see the library and can download; editors and admins also get Add / revise / edit / delete.
- **Values are shown verbatim.**
  - `null` renders as "—" (no value).
  - Placeholders (`N/A`, `NA`, `-`, `NIL` …) are shown exactly as stored, styled as placeholders.
  - Inputs are never trimmed or rewritten. Invalid input (surrounding spaces, line breaks) is rejected
    with a message, mirroring the API's rules.
- **Current vs original.** Each row carries `origin`, `current`, `original` and `modified_fields`:
  - modified values are underlined in amber, with the original in a tooltip;
  - "Show original values" puts the original inline;
  - rows added in the new system are marked blue ("New").
- **Sections that may be missing.**
  - "Not recorded in the legacy system": the legacy page didn't show the section.
  - "The legacy system listed no …": it showed the section with no entries.
  - App-created plants have neither.
- **Order.** Rows keep their `position`. They can be reordered by drag and drop (dnd-kit, keyboard
  accessible) or with explicit Move up / Move down, and every reorder is a single `PUT …/order`.

## Known API constraints (API unchanged)

- History is per plant, so the dashboard shows "plants with edits" rather than a global activity feed.
- A plant's `updated_at` only changes when its own fields change, so the list doesn't show a "last modified"
  column.
- The change reason travels in an HTTP header, so it is limited to Latin-1 characters. The UI validates this.
- When a filter value or accessory entry is deleted, the Legacy source summary can't show it (the API only
  keeps the group name as the original). History records every deletion.

## Tests

End-to-end tests (Playwright) run against the full stack with a freshly seeded database:

```bash
export PDM_USER_VIEWER=… PDM_PASS_VIEWER=… PDM_USER_EDITOR=… PDM_PASS_EDITOR=… PDM_USER_ADMIN=… PDM_PASS_ADMIN=…
PDM_E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

Run against a freshly seeded database (the suites add and delete data, and some assertions use
seeded counts, e.g. 53 matches for `CRN 10-12`). `--project=chromium` runs the desktop specs
(67 tests); the mobile projects run `e2e/mobile.spec.ts`.

`e2e/app.spec.ts` and `e2e/users.spec.ts` cover:
- sign-in and sign-out;
- search, filters, pagination and the plant switcher;
- every section, placeholders, repeated parameters and missing sections;
- viewer, editor and admin role limits;
- inline and drawer editing, add, delete, drag-and-drop and button reordering, modules, filters and
  HP accessories;
- optimistic-concurrency conflicts and validation;
- admin create and delete;
- the legacy source view;
- API error states;
- mobile layout without horizontal overflow.

`e2e/equipment.spec.ts` (10 tests): search across every plant, URL state, single- and multi-zone
selection with comparable counts, zero-count zones, make/model/type facets (including case-grouped
makes), per-list search, links to plants, empty results, and edits becoming searchable at once.

`e2e/documents.spec.ts` (29 tests):
- viewing (empty state, row details, counts, viewer has no edit controls);
- uploading by picker and by drag and drop, and the upload in History;
- category filter with counts, search, default category, re-filing and renaming;
- downloading the exact bytes; inline preview only for PDFs/images;
- revisions (same document, new bytes, History shows the new checksum) and the duplicate-name warning;
- deleting with confirmation (file really gone, recorded in History);
- roles: viewer blocked in UI and API, admin allowed, signed-out visitors refused;
- errors: refused types, missing extension, empty and oversize files, server refusal keeps the form,
  dangerous/duplicate uploads refused by the API, stale-edit conflict, load failure with retry,
  cross-plant document ids;
- the BFF proxy: binary round trip with hash and headers, 15 MB and just-under-25 MB files,
  over-limit 413, non-ASCII names, revisions, CSRF header and session required.

`e2e/mobile.spec.ts` repeats the layout checks on six device profiles: 320px Android, Pixel 7,
iPhone SE, iPhone 15 Pro Max, iPhone landscape and iPad Mini. The iPhone and iPad profiles run in
WebKit. Each check covers every page plus open menus, drawers and dialogs — including the equipment
search with filters and zones in use, and the document library with its upload, revision, edit and
delete dialogs — and asserts:
- nothing scrolls sideways;
- overlays fit the screen;
- icons keep their shape;
- inputs use ≥16px text, so iOS doesn't zoom in on focus.

`PDM_E2E_CHROMIUM=/path/to/chrome` runs every project in that Chromium instead of Playwright's own
browsers (for machines where `npx playwright install` is not possible). The iPhone/iPad profiles then
emulate the device's viewport and touch in Chromium, not Safari's engine.

When testing against a plain-HTTP server, start Next.js with `PDM_COOKIE_SECURE=false`, because
Safari drops Secure cookies over HTTP. Production should be served over HTTPS.
