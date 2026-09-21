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

The API must be running. See `../api/API.md`; the API needs its tokens file.
To sign in, paste an API token created with `python ../api/tools/make_token.py <name> <role>`.

## Structure

```
src/
├── proxy.ts                        redirect visitors without a session to /login
├── app/
│   ├── login/                      token sign-in (replaceable by SSO)
│   ├── api/auth/{login,logout}     create / end the session (httpOnly cookie)
│   ├── api/pdm/[...path]           authenticated proxy to FastAPI
│   └── (app)/                      authenticated area (layout validates the session via GET /me)
│       ├── page.tsx                dashboard
│       ├── plants/                 list + search
│       └── plants/[id]/            detail frame (sticky header, tabs)
│           ├── page.tsx            plant data (all sections, editing)
│           ├── history/            audit history
│           └── legacy/             read-only legacy source
├── components/
│   ├── shell/                      sidebar, ⌘K plant switcher, user menu
│   ├── plant/                      section cards, table sections, grouped sections, editing primitives
│   ├── history/describe.ts         change_log rows -> readable change sets
│   ├── legacy/                     provenance, reconciliation, original record
│   └── common/                     value rendering, states (loading/empty/error)
└── lib/
    ├── api/{types,client,hooks}.ts typed API client + TanStack Query hooks
    ├── auth/session.ts             server-side credential storage (SSO swap point)
    ├── auth/session-context.tsx    current user + role checks in the UI
    ├── sections.ts                 section definitions, legacy terminology, columns
    └── values.ts                   display helpers (never rewrite values)
```

## Key decisions

- **BFF proxy.** `/api/pdm/*` adds `Authorization: Bearer <token>` from an httpOnly, SameSite=Lax cookie.
  - Only three request headers are forwarded (`Content-Type`, `X-Change-Reason`, `X-Request-ID`).
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
export PDM_TOKEN_VIEWER=… PDM_TOKEN_EDITOR=… PDM_TOKEN_ADMIN=…
PDM_E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

The 24 scenarios cover:
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
