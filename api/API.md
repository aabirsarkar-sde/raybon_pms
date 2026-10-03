# Plant Data Management API (v1)

```
PostgreSQL (database/schema.sql)  →  this API  →  new frontend (not built yet)
```

Interactive OpenAPI docs are served at `/docs` (and `/openapi.json`) when the server is running.

---

## 1. Architecture

```
api/
├── pdm_api/
│   ├── main.py         app factory, request-id middleware, DB-error → HTTP mapping, /health
│   ├── config.py       settings from env (DATABASE_URL, PDM_API_TOKENS_FILE, PDM_DOCUMENT_*), token loading
│   ├── auth.py         bearer-token authentication, role checks (viewer < editor < admin)
│   ├── db.py           psycopg3 connection pool; read snapshot tx; write tx carrying audit context
│   ├── collections.py  declarative spec of every ordered, editable child list
│   ├── models.py       request bodies + validation rules (pydantic v2)
│   ├── repository.py   SQL, ordered-list operations, current-vs-original serialisation
│   ├── routes.py       endpoints (collection routes generated from collections.py)
│   ├── equipment.py    cross-plant equipment search: every equipment list projected onto one shape
│   ├── search_routes.py  GET /equipment/search, /equipment/kinds
│   ├── documents.py    document storage (PostgreSQL or disk), upload checks, download headers
│   └── document_routes.py  plant document library endpoints
├── tests/              pytest suite (91 tests) against a real PostgreSQL
├── tools/make_token.py create API tokens
├── tools/create_user.py create a user / reset a password
├── requirements.txt / requirements-dev.txt
└── pytest.ini
```

- **Stack:** Python 3.12+, FastAPI, pydantic v2, psycopg 3 + psycopg_pool, PostgreSQL 13+ (tested 16.2).
- **Plain SQL, no ORM.** Queries are explicit. Every table and column name comes from the fixed spec in
  `collections.py`, and every value is passed as a parameter.
- **One transaction per write request.** The API writes the user, reason and request id into the
  transaction, and the database's `log_change` trigger records them. The application code never
  writes to `change_log`.
- **Consistent reads.** A multi-query read, such as a full plant document, runs in one
  `REPEATABLE READ READ ONLY` transaction.
- **Least-privilege database role.** The API connects as `pdm_api` (`database/roles.sql`). That role can
  read everything but can write only the editable working tables.
- **One generic code path for all ordered lists.** It covers the equipment tables, design
  parameters, filters and their values, and HP accessory groups and their entries. Adding or changing
  a list is a one-line change in `collections.py`.

### Current vs. original

Every row the API returns has this shape:

```json
{
  "id": 1, "position": 1,
  "origin": "legacy",                 // "legacy" = imported, "app" = created in the new system
  "current":  { ...editable values... },
  "original": { ...legacy values... }, // from the immutable `source` column; null for app rows
  "modified_fields": ["motor_kw"],    // where current ≠ original
  "derived":  { "motor_kw_numeric": 7.5 },  // read-only; only when the text is a plain number
  "created_at": "...", "updated_at": "..."
}
```

- **What the API changes:** only `current` values. A request can never set `original`, `source`,
  `source_value`, `legacy_plant_id`, `id` or `position`; any of these in a request body is rejected.
- **Where the full source record is:** `GET /plants/{id}/legacy` returns it, unchanged.

## 2. Endpoints

All paths are under `/api/v1`, and all require `Authorization: Bearer <token>`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/health` (no prefix, no auth) | — | Liveness + DB check |
| GET | `/me` | any | Current user and role |
| GET | `/zones` | viewer | Zones with plant counts |
| POST | `/zones` | admin | Create zone |
| GET | `/plants` | viewer | List/search (below) |
| POST | `/plants` | admin | Create a new (non-legacy) plant; its 5 stage rows + total row are created |
| GET | `/plants/{id}` | viewer | **Complete plant**: core fields, modules, all 8 sections |
| GET | `/plants/by-legacy-id/{legacy_id}` | viewer | Same document, looked up by legacy ID |
| PATCH | `/plants/{id}` | editor | Edit name, display_name, serial_number, capacity, site_contact_number, zone_id |
| DELETE | `/plants/{id}` | admin | Delete an **app-created** plant (legacy plants → 409) |
| GET | `/plants/{id}/legacy` | viewer | Immutable legacy snapshot(s) + raw-HTML hash |
| GET | `/plants/{id}/history` | viewer | Change log for the plant and all its rows (`?request_id=`, `limit`, `offset`) |
| GET | `/plants/{id}/modules` | viewer | Stage 1–5 + total |
| PATCH | `/plants/{id}/modules/{1..5\|total}` | editor | Edit value_text / quantity / module_type |
| GET | `/equipment/search` | viewer | Cross-plant equipment search with plant/zone counts ([§2.1](#21-cross-plant-equipment-search)) |
| GET | `/equipment/kinds` | viewer | The searchable equipment lists |
| GET | `/document-categories` | viewer | Document categories, accepted extensions, size limit ([§2.2](#22-plant-document-library)) |
| GET | `/plants/{id}/documents` | viewer | A plant's documents (`?category=`, `?q=`) with per-category counts |
| POST | `/plants/{id}/documents` | editor | Upload (multipart); `replace=true` uploads a new revision |
| GET | `/plants/{id}/documents/{doc_id}` | viewer | One document's details |
| GET | `/plants/{id}/documents/{doc_id}/content` | viewer | The file (`?inline=true` to view PDFs/images in the browser) |
| PATCH | `/plants/{id}/documents/{doc_id}` | editor | Re-file / rename: `category`, `title`, `description` |
| DELETE | `/plants/{id}/documents/{doc_id}` | editor | Delete the document and its file |

The plant document (`GET /plants/{id}`) and each `GET /plants` item carry `documents`, the plant's
document count.

**Ordered collections.** Each of these supports the same six operations.

`{coll}` is one of `design-parameters`, `pumps-and-motors`, `instruments`, `hmi-plc`, `vfds`, `dosing-pumps`, `filters`, `hp-pump-accessories`:

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/plants/{id}/{coll}` | viewer | `{legacy: {rendered, count}, items: [...]}` in order |
| POST | `/plants/{id}/{coll}` | editor | Add; optional `position` (default: append); later rows shift down |
| PUT | `/plants/{id}/{coll}/order` | editor | Reorder: `{"ids": [every id, new order]}` |
| GET | `/plants/{id}/{coll}/{item_id}` | viewer | One row |
| PATCH | `/plants/{id}/{coll}/{item_id}` | editor | Edit fields |
| DELETE | `/plants/{id}/{coll}/{item_id}` | editor | Remove; later rows shift up |

**Nested lists.** The same six operations also exist for filter values and accessory entries:
- `/plants/{id}/filters/{filter_id}/values[/{value_id}|/order]`
- `/plants/{id}/hp-pump-accessories/{group_id}/entries[/{entry_id}|/order]`

When you create a filter or group, you can include its children in the same request:
`{"name": "Carbon Filter", "values": [{"value": "1 Nos."}]}`.

**Editable fields per list:**

| Collection | Fields | Derived (read-only) |
|---|---|---|
| design-parameters | parameter_name, value, unit | value_numeric (`original` also shows `unit_raw`) |
| pumps-and-motors | equipment_code, pump_make, pump_model, motor_make, motor_kw, motor_amp | motor_kw_numeric, motor_amp_numeric |
| instruments, hmi-plc, vfds | name, make, model | — |
| dosing-pumps | dosing_pump_for, make, model | — |
| filters → values | name → label, value | — |
| hp-pump-accessories → entries | group_name → label, value | — |

**`GET /plants` query parameters:**
- `q`: substring match on name, display_name or serial_number.
- `zone_id`, or `zone` (zone name, case-insensitive).
- `serial_number` (exact) and `legacy_plant_id`.
- `origin`: `legacy` or `app`.
- `modified`: `true` for plants with any change-log entry, `false` for untouched plants.
- `equipment`: substring match on any equipment code, name, make or model, or on a filter or group name.
- `sort`: `legacy_plant_id` (default), `name`, `serial_number`, `zone` or `updated_at`. Prefix with `-` for descending.
- `limit` (1–500, default 50) and `offset`.

### 2.1 Cross-plant equipment search

`GET /equipment/search` answers "which plants have this equipment, and in which zones?". Every
equipment list is projected onto one shape and searched together:

| `kind` | List | `type` is | make | model |
|---|---|---|---|---|
| `pumps` | Pumps (pumps-and-motors) | pump code | pump_make | pump_model |
| `motors` | Motors (pumps-and-motors) | pump code | motor_make | — (kW/A in `detail`) |
| `instruments` | Instruments | name | make | model |
| `hmi_plc` | HMI & PLC | name | make | model |
| `vfds` | VFDs | name | make | model |
| `dosing_pumps` | Dosing pumps | dosing_pump_for | make | model |
| `filters` | Filters | filter name | — | — |
| `hp_pump_accessories` | HP pump accessories | group name | — | — |

HMI and PLC share one legacy list whose rows are named "HMI & PLC", "Module 1" and so on, so they
cannot be split into two kinds; the Type facet separates them where plants recorded them separately.

**Query parameters** (all optional; list parameters are repeatable, `?zone=Vadodara&zone=Dahej`):
- `q`: substring match on any make, model, type or value (e.g. `CRN 10-15`).
- `kind`: one or more kinds from the table above. Unknown kinds → 422.
- `make`, `model`, `type`: exact match, case-insensitive (`GRUNDFOS` = `Grundfos`).
- `zone_id` or `zone` (name, case-insensitive): one, two or many zones. `unzoned=true` adds plants with
  no zone.
- `sort` (plant order): `items` (default, most matches first), `name`, `zone`, `legacy_plant_id`.
- `limit` (1–200, default 25) and `offset`: plants per page. `matches` (0–200, default 25): matching
  rows listed per plant. `facet_limit` (0–2000, default 300): values per make/model/type facet.

**Response.** `summary` and `plants` honour every filter. The `zones`, `kinds` and `facets`
breakdowns each **ignore their own filter**, so after choosing Vadodara the other zones still show
their counts, and after choosing a model the other models are still offered. Every zone is listed,
with zeros where nothing matches. Make/model/type values that differ only in case are grouped into
one facet value (`spellings` says how many were merged); the stored values are never rewritten.

`GET /equipment/search?model=CRN 10-12&zone=Vadodara&limit=1&matches=1&facet_limit=2` (trimmed):
```json
{
  "summary": {"items": 10, "plants": 8, "zones": 1},
  "zones": [
    {"zone": {"id": 6, "name": "Vadodara"},   "items": 10, "plants": 8},
    {"zone": {"id": 2, "name": "Ankleshwar"}, "items": 6,  "plants": 3},
    {"zone": {"id": 5, "name": "Panoli"},     "items": 0,  "plants": 0}
  ],
  "unzoned": {"items": 0, "plants": 0},
  "kinds": [{"kind": "pumps", "label": "Pumps", "type_label": "Pump code", "slug": "pumps-and-motors",
             "has_make": true, "has_model": true, "items": 10, "plants": 8}],
  "facets": {
    "make": [{"value": "GRUNDFOS", "items": 6, "plants": 6, "spellings": 1}]
  },
  "facets_truncated": ["make", "model", "type"],
  "plants": {
    "items": [{
      "plant": {"id": 59, "display_name": "AMI LIFE SCIENCE, KARKHADI - 3247 (PTRO)  - 150W",
                "zone": {"id": 6, "name": "Vadodara"}, "legacy_plant_id": 1064},
      "items": 2,
      "matches": [{"kind": "pumps", "id": 390, "position": 3, "type": "PK162",
                   "make": "GRUNDFOSE", "model": "CRN 10-12", "detail": {}}]
    }],
    "total": 8, "limit": 1, "offset": 0
  },
  "filters": {"q": null, "kind": [], "make": [], "model": ["CRN 10-12"], "type": [],
              "zone_id": [], "zone": ["Vadodara"], "unzoned": false},
  "sort": "items"
}
```
A match's `kind` + `id` identify the row; `GET /plants/{plant.id}/{slug}/{id}` returns it.

### 2.2 Plant document library

Each plant has its own library of files (P&IDs, electrical and mechanical drawings, layouts, manuals,
datasheets, reports, certificates, site photos). Migration
`database/migrations/002_documents_and_equipment_search.sql` creates `plant_documents` (one row per
document) and `plant_document_blobs` (the bytes).

- **Categories:** `pid`, `electrical`, `mechanical`, `layout`, `manual`, `datasheet`, `report`,
  `certificate`, `photo`, `other`. `GET /document-categories` returns them with their labels, the
  accepted extensions and `max_bytes`.
- **Upload** — `POST /plants/{id}/documents`, `multipart/form-data`:
  `file` (required), `category` (required), `title` (required, 1–300 chars), `description` (optional,
  ≤ 2000), `replace` (default `false`). Returns 201 with the document.
- **One file per (plant, category, file name)**, file name compared case-insensitively. Uploading the
  same name again without `replace=true` → 409. With `replace=true` the existing document is updated
  in place (a new revision): same `id`, new bytes, `sha256`, `byte_size`, title and description.
- **Re-file / rename** — `PATCH` with any of `category`, `title`, `description` (and optionally
  `expected_updated_at`, see §5.8). The file is untouched.
- **Delete** — `DELETE` removes the row and the stored file.
- **List** — `GET /plants/{id}/documents?category=&q=` (`q` matches title, description and file name),
  newest first. `counts` and `total_bytes` always cover the whole library, so a category filter still
  shows what else is there.

**Upload rules.** The file's extension decides everything; the `Content-Type` the client sends is
ignored.
- Accepted: `pdf png jpg jpeg gif webp tif tiff bmp heic dwg dxf dwf doc docx xls xlsx ppt pptx txt csv
  zip rar 7z`. Anything else, including `.html`, `.svg` and `.exe`, → 422. A file with no extension → 422.
- The stored `content_type` comes from the extension (`.dwg` → `image/vnd.dwg`).
- Empty files → 422. Files over `PDM_DOCUMENT_MAX_MB` (default 25 MB) → 413. The limit is checked
  while the received file is read in chunks, before anything is stored.
- File names keep their own script (`Anlagenplan Übersicht.pdf`). Any directory part is dropped, and
  control characters and `<>:"/\|?*` are replaced with `_`.

**Downloads.** `…/content` always sends `X-Content-Type-Options: nosniff`, `Cache-Control: private,
max-age=0, must-revalidate`, an `ETag` of the file's SHA-256, and
`Content-Disposition: attachment; filename="…"; filename*=UTF-8''…` (RFC 5987, so non-ASCII names
survive). `?inline=true` serves PDFs and PNG/JPEG/GIF/WebP/BMP images inline for preview; every other
type is still sent as an attachment, so an uploaded file can never run as a page in the app's origin.
`can_preview` in the document payload says whether inline viewing is available.

**Document payload:**
```json
{
  "id": 1, "plant_id": 1, "category": "pid", "category_label": "P&ID",
  "title": "RO skid P&ID", "description": "Rev A from Raybon",
  "file_name": "RO skid PID.pdf", "extension": "pdf", "content_type": "application/pdf",
  "byte_size": 3000000, "sha256": "167cb4a0…", "can_preview": true,
  "uploaded_by": "eddie.editor",
  "created_at": "2026-10-03T17:27:15.642115+00:00", "updated_at": "2026-10-03T17:27:15.642115+00:00",
  "href": "/api/v1/plants/1/documents/1", "download_href": "/api/v1/plants/1/documents/1/content"
}
```

**Storage** (`PDM_DOCUMENT_STORAGE`):
- `db` (default): bytes in `plant_document_blobs`. Nothing outside PostgreSQL to deploy or back up.
- `fs`: bytes under `PDM_DOCUMENT_ROOT` on the API server, for libraries of large drawings. Keys are
  random (`plants/<id>/<32 hex>.<ext>`) and checked against the root before every read.

Each document records which backend holds it, so switching the setting affects new uploads only.
Documents already on disk stay readable after switching back to `db` as long as `PDM_DOCUMENT_ROOT`
is still set (otherwise their downloads return 503). Listing never reads file bytes, and the audit log never copies them
(the trigger is on `plant_documents`, not on the blob table).

## 3. Request / response examples

These are real responses from the seeded database, trimmed where marked.

**List/search**
```http
GET /api/v1/plants?q=torrent&limit=2
```
```json
{
  "items": [{
    "id": 1, "legacy_plant_id": 1, "origin": "legacy",
    "name": "torrent pharma. ltd. indrad, mehsana",
    "display_name": "TORRENT PHARMA. LTD. INDRAD, MEHSANA - 2094 (HPRO)  - 400W",
    "serial_number": "2094", "capacity": "400w", "site_contact_number": "9376447920",
    "zone": {"id": 1, "name": "Ahmedabad"},
    "has_changes": false,
    "counts": {"design_parameters": 12, "pumps_and_motors": 17, "instruments": 15, "hmi_plc": 10,
               "vfds": 5, "dosing_pumps": 4, "filters": 4, "hp_pump_accessories": 3},
    "created_at": "2026-09-21T13:13:00.678002+05:30", "updated_at": "2026-09-21T13:13:00.678002+05:30",
    "href": "/api/v1/plants/1"
  }],
  "total": 1, "limit": 2, "offset": 0
}
```

**Complete plant** (trimmed to one item per section)
```http
GET /api/v1/plants/1
```
```json
{
  "id": 1, "legacy_plant_id": 1, "origin": "legacy",
  "current":  {"name": "torrent pharma. ltd. indrad, mehsana", "display_name": "TORRENT PHARMA. LTD. INDRAD, MEHSANA - 2094 (HPRO)  - 400W",
               "serial_number": "2094", "capacity": "400w", "site_contact_number": "9376447920", "zone_id": 1, "zone_name": "Ahmedabad"},
  "original": {"name": "torrent pharma. ltd. indrad, mehsana", "display_name": "TORRENT PHARMA. LTD. INDRAD, MEHSANA - 2094 (HPRO)  - 400W",
               "serial_number": "2094", "capacity": "400w", "site_contact_number": "9376447920", "zone_name": "Ahmedabad"},
  "modified_fields": [],
  "modules": [
    {"stage": 1, "id": 1, "position": 1, "origin": "legacy",
     "current":  {"value_text": "26(ST)", "quantity": 26, "module_type": "ST"},
     "original": {"value_text": "26(ST)", "quantity": 26, "module_type": "ST"}, "modified_fields": [], "...": "..."}
  ],
  "sections": {
    "design_parameters": {
      "title": "Design parameter", "endpoint": "/api/v1/plants/1/design-parameters",
      "legacy": {"rendered": true, "count": null},
      "items": [{"id": 1, "position": 1, "origin": "legacy",
                 "current":  {"parameter_name": "Feed Flow", "value": "20", "unit": "m³/Hr."},
                 "original": {"parameter_name": "Feed Flow", "value": "20", "unit": "m³/Hr.", "unit_raw": "(m³/Hr.)"},
                 "modified_fields": [], "derived": {"value_numeric": 20}, "...": "..."}]
    },
    "pumps_and_motors": {
      "legacy": {"rendered": true, "count": 17},
      "items": [{"id": 1, "position": 1, "origin": "legacy",
                 "current": {"equipment_code": "PK121", "pump_make": "GRUNDFOS", "pump_model": "CRN 45-2-2",
                             "motor_make": "GRUNDFOS", "motor_kw": "7.5", "motor_amp": "12.2"},
                 "original": {"...same...": "..."}, "derived": {"motor_kw_numeric": 7.5, "motor_amp_numeric": 12.2}}]
    },
    "filters": {
      "legacy": {"rendered": true, "count": 4},
      "items": [{"id": 1, "position": 1, "current": {"name": "Sand Filter"}, "original": {"name": "Sand Filter"},
                 "values": [{"id": 1, "position": 1, "current": {"label": null, "value": "4272"},
                             "original": {"label": null, "value": "4272"}, "...": "..."},
                            "... 3 more, in order ..."]}]
    },
    "instruments": "...", "hmi_plc": "...", "vfds": "...", "dosing_pumps": "...", "hp_pump_accessories": "..."
  },
  "links": {"self": "/api/v1/plants/1", "legacy_snapshot": "/api/v1/plants/1/legacy", "history": "/api/v1/plants/1/history"}
}
```

`legacy.rendered = false` means the legacy page did not show the section at all. `rendered = true` with no
items means it was shown but empty. App-created plants have `legacy: null`.

**Edit equipment** (the original value is kept)
```http
PATCH /api/v1/plants/1/pumps-and-motors/1
X-Change-Reason: Nameplate check
X-Request-ID: req-42

{"motor_kw": "7.5 kW", "expected_updated_at": "2026-09-21T13:13:00.678002+05:30"}
```
```json
{
  "id": 1, "position": 1, "origin": "legacy",
  "current":  {"equipment_code": "PK121", "pump_make": "GRUNDFOS", "pump_model": "CRN 45-2-2",
               "motor_make": "GRUNDFOS", "motor_kw": "7.5 kW", "motor_amp": "12.2"},
  "original": {"equipment_code": "PK121", "pump_make": "GRUNDFOS", "pump_model": "CRN 45-2-2",
               "motor_make": "GRUNDFOS", "motor_kw": "7.5", "motor_amp": "12.2"},
  "modified_fields": ["motor_kw"],
  "derived": {"motor_kw_numeric": null, "motor_amp_numeric": 12.2},
  "created_at": "2026-09-21T13:13:00.678002+05:30", "updated_at": "2026-09-21T13:13:16.415615+05:30"
}
```

**Add equipment at a position**
```http
POST /api/v1/plants/1/instruments
X-Change-Reason: Installed 2026-09

{"name": "PS190", "make": "ORION", "model": "MZ10", "position": 3}
```
```json
{"id": 1222, "position": 3, "origin": "app",
 "current": {"name": "PS190", "make": "ORION", "model": "MZ10"},
 "original": null, "modified_fields": [], "created_at": "...", "updated_at": "..."}
```

**Reorder**
```http
PUT /api/v1/plants/1/vfds/order

{"ids": [5, 4, 3, 2, 1]}
```
→ `200 {"items": [ ...all rows, positions 1..5 in the new order... ]}`

**History**
```http
GET /api/v1/plants/1/history?limit=3
```
```json
{"items": [
  {"id": 16, "table_name": "instruments", "row_id": 1222, "operation": "INSERT",
   "column_name": null, "old_value": null, "new_value": null, "old_row": null,
   "new_row": {"id": 1222, "plant_id": 1, "position": 3, "name": "PS190", "make": "ORION", "model": "MZ10", "source": null, "...": "..."},
   "changed_by": "jane@plant.example", "reason": "Installed 2026-09",
   "request_id": "ccccdca7edb7491d8ed4f18a256532fd", "changed_at": "..."},
  {"id": 15, "table_name": "instruments", "row_id": 15, "operation": "UPDATE",
   "column_name": "position", "old_value": 15, "new_value": 16,
   "changed_by": "jane@plant.example", "reason": "Installed 2026-09",
   "request_id": "ccccdca7edb7491d8ed4f18a256532fd", "changed_at": "..."},
  {"id": 14, "table_name": "instruments", "row_id": 14, "operation": "UPDATE",
   "column_name": "position", "old_value": 14, "new_value": 15, "...": "..."}
 ], "total": 16, "limit": 3, "offset": 0}
```
The insert at position 3 and the rows it pushed down all share one `request_id`. Earlier in the same
history, the pump edit above appears as `pumps_and_motors` / `motor_kw` / `"7.5"` → `"7.5 kW"` with
reason `Nameplate check` and request id `req-42`.

**Legacy snapshot**
```http
GET /api/v1/plants/1/legacy
```
```json
{"plant_id": 1, "legacy_plant_id": 1, "immutable": true,
 "records": [{"id": 1,
   "import_batch": {"id": 1, "source_path": "plantdata_export/structured", "schema_version": "1.0.0", "imported_at": "..."},
   "raw_file": "raw/plant_1.html",
   "raw_sha256": "06d3b0f5a1acf041a376e390885470b954a1c4da4d3e06474706799bded57a64",
   "metadata_file": "metadata/plant_1.json",
   "endpoint": "https://zd.plantdata.athsoftware.com/Home/GetDashboardData?plantId=1",
   "http_status": 200, "imported_at": "...",
   "record": {"...the complete structured JSON record, byte-for-byte equal to plant_1.json...": ""}}]}
```

**Errors**

| Status | When | Body |
|---|---|---|
| 401 | missing/unknown token | `{"detail": "Missing bearer token"}` |
| 403 | role too low | `{"detail": "This action requires the 'editor' role"}` |
| 404 | plant/row not found, or row belongs to another plant/parent | `{"detail": "Pump and motor 7 not found"}` |
| 409 | stale `expected_updated_at` | `{"detail": {"message": "The row was modified by someone else; reload and retry.", "current_updated_at": "..."}}` |
| 409 | deleting a legacy plant; DB immutability/uniqueness rule | `{"detail": "...", "database": "<postgres message>"}` |
| 409 | uploading a document whose name is already in that category, without `replace=true` | `{"detail": "'x.pdf' is already in this plant's pid documents. Send replace=true to update it."}` |
| 410 | a document's stored file is missing | `{"detail": "The stored file for this document is missing"}` |
| 413 | document larger than `PDM_DOCUMENT_MAX_MB` | `{"detail": "The file is larger than the 25 MB limit"}` |
| 422 | validation | pydantic list, e.g. `[{"loc": ["body","capacity"], "msg": "Value error, empty string is not allowed; send null for 'no value'"}, {"loc": ["body","source"], "msg": "Extra inputs are not permitted"}]` |

## 4. Authentication and authorization

**Username and password sign-in with roles (RBAC).** Accounts live in `app_users`, created by
migration `database/migrations/001_user_accounts.sql`.

- **Signing in.** `POST /auth/login {username, password}` returns a session token (`pdms_…`),
  valid for 12 hours (`PDM_SESSION_HOURS`). Send it as `Authorization: Bearer <token>`.
  - Only the token's SHA-256 is stored.
  - Usernames are case-insensitive.
  - `POST /auth/logout` revokes the session.
- **Passwords** are stored as scrypt hashes and must be at least 8 characters, and different from the username.
  - `POST /auth/change-password` changes your own password and signs out your other sessions.
- **Lockout.** Five wrong passwords lock the account for 15 minutes (the API returns 429). An admin
  can unlock it sooner. Wrong username and wrong password give the same message.
- **Roles** are cumulative, and each role includes the ones before it:
  - **viewer**: read everything.
  - **editor**: plus edit plant data, and upload, revise, re-file and delete plant documents.
  - **admin**: plus create and delete app-created plants, create zones, and manage users.
  - The role is read from the database on every request, so role changes and deactivation apply at once.
- **User administration** (admin only):
  - `GET /users` lists the users.
  - `POST /users {username, display_name?, role, password}` creates one.
  - `PATCH /users/{id} {display_name?, role?, is_active?, unlock?}` edits one.
  - `POST /users/{id}/password {new_password}` resets a password, unlocks the account and signs the user out.
- **Safety rules:**
  - Accounts are deactivated, never deleted, so history stays attributed.
  - Admins can't deactivate themselves or change their own role.
  - The API always keeps at least one active admin.
- **Audit.** Account changes are recorded in `change_log` (`table_name = 'app_users'`). Password hashes
  and session tokens are never logged.
- **Service tokens (optional).** A token file (`PDM_API_TOKENS_FILE`, created with `tools/make_token.py`)
  still works for scripts. People should use accounts.
- **First admin / password recovery:**
  `DATABASE_URL=… python api/tools/create_user.py <username> --role admin` prompts for the password.
  If the user already exists, it resets the password and unlocks and reactivates the account.

## 5. Validation rules

1. **Values are never silently rewritten.** Text is stored exactly as sent. Anything that would need
   rewriting is rejected with 422:
   - an empty string (send `null` for "no value");
   - leading or trailing whitespace;
   - control characters other than tab, since legacy data contains tabs inside values;
   - more than 1,000 characters.

   None of the 172 legacy records contains a value that breaks these rules, so a client can always send
   back an unchanged legacy value.
2. **Placeholders are ordinary text.** `N/A`, `NA`, `-`, `NIL`, `Nil`, `na` and `nA` are accepted and
   stored as-is. The API never turns them into `null`.
3. **Unknown fields are rejected** (`extra="forbid"`). That includes read-only fields such as `id`,
   `source`, `source_value`, `original`, `legacy_plant_id`, `plant_id`, the `*_numeric` columns and
   `position` in a PATCH.
4. **Strict types.** `"3"` is not accepted where an integer is expected, and numbers are not accepted
   where text is expected.
5. **Plant rules:**
   - `name` is required and can't be `null`.
   - `zone_id` must exist.
   - A PATCH must change at least one field.
6. **Module rules:**
   - The stage must be `1`–`5` or `total`.
   - `quantity` must be an integer ≥ 0 or `null`.
   - If only `value_text` is sent, `quantity` and `module_type` are recalculated with the import rule
     (`3(HPRO)` → 3, `HPRO`). Unparsable text sets them to `null`.
7. **Ordered-list rules:**
   - A new row needs at least one non-null field.
   - `position` must be between 1 and n+1.
   - A reorder request must list every current id exactly once.
   - A row id must belong to the plant, filter or group in the URL, otherwise 404.
   - Duplicate names are allowed, e.g. repeated design parameters.
8. **Optimistic concurrency (optional).** Send `expected_updated_at` (the `updated_at` you last read) in
   a PATCH. If someone else changed the row since then, you get 409 and nothing is saved.
9. **Headers:**
   - `X-Change-Reason` is optional, at most 500 characters, no control characters.
   - `X-Request-ID` is optional, `[A-Za-z0-9._:-]{1,100}`. It is generated when absent and always echoed back.

## 6. Audit logging

The database does the logging: an `AFTER INSERT OR UPDATE OR DELETE` trigger (`log_change`) runs on
every data table. It records any write, whether it comes from the API or from a person in `psql`.

- **What each write request sets:** the API opens one transaction and runs
  `set_config('pdm.changed_by' | 'pdm.change_reason' | 'pdm.request_id', …, true)`.
  These settings last only for that transaction.
- **What each `change_log` row holds:**
  - `table_name`, `row_id`, `plant_id`, `operation`
  - for an UPDATE, one row per changed column, with `column_name`, `old_value` and `new_value`
  - for an INSERT, the full new row in `new_row`
  - for a DELETE, the full old row in `old_row`
  - `changed_by`, `reason`, `request_id`, `changed_at`
- **One request can produce several log rows.** For example, inserting at position 2 logs the INSERT
  plus a position UPDATE for every row that moved down. All of them share the request's `request_id`.
- **Deletes keep their plant.** `plant_id` is recorded even for grandchild rows removed by a cascade,
  e.g. filter values when their filter is deleted, so the plant's history is complete.
- **The log is append-only.** Triggers block UPDATE, DELETE and TRUNCATE on `change_log`, even for the
  table owner. The API role has read-only access to it, and `log_change` is `SECURITY DEFINER`, so the
  API writes to the log only through the trigger.
- **Documents are audited too.** Uploads, revisions, re-filing and deletions of `plant_documents`
  rows are logged with the plant's id, like any other plant change. The file bytes live in a separate
  table and are never copied into the log; a revision shows as changed `sha256` / `byte_size`.
- **How to read it:** `GET /plants/{id}/history`, filterable by `request_id`.
- **The legacy import is not logged row by row.** It is recorded once in `import_batches` instead, so
  `change_log` starts empty.

## 7. How the immutable legacy snapshot is protected

The protection has four layers:

1. **API surface.** No endpoint writes to `legacy_plant_records`, `import_batches`, `plant_sections`, or
   any `source` / `source_value` column. Request bodies that mention those fields are rejected. The
   snapshot is served read-only at `GET /plants/{id}/legacy`.
2. **Database privileges (`database/roles.sql`).**
   - The API's `pdm_api` role has only `SELECT` on `legacy_plant_records`, `import_batches`,
     `plant_sections` and `change_log`.
   - It has no `TRUNCATE` on any table.
   - It can write only the 13 working tables, the account tables and the document library
     (`plant_documents`, `plant_document_blobs`).
3. **Database triggers**, which apply to every role, including the owner:
   - `legacy_plant_records` and `import_batches` block UPDATE, DELETE and TRUNCATE.
   - The `source` / `source_value` columns on working rows are write-once, and so are
     `plants.legacy_plant_id` and `plant_sections`.
   - Deleting a legacy plant is blocked by a foreign key from `legacy_plant_records`. The API also
     answers 409 before it gets that far.
4. **Verification.**
   - `raw_sha256` ties each snapshot to its scraped HTML file.
   - `seed_from_json.py --verify-only` checks that every snapshot and every working table can be
     rebuilt into the structured JSON exactly.
   - A working value that differs from its original shows up in `modified_fields`.

The test suite covers every layer. Tests connect as `pdm_api` and try each forbidden write, then
connect as the owner and try to rewrite the snapshot and the change log.

---

## Running

```bash
.venv/bin/pip install -r api/requirements.txt       # includes python-multipart, needed for uploads
# database: see database/schema.md (schema.sql, migrations/*.sql, seed, then roles.sql; set a password for pdm_api)
# existing database: apply new migrations in order as the schema owner, then re-run roles.sql:
#   psql "$OWNER_DSN" -f database/migrations/002_documents_and_equipment_search.sql
#   psql "$OWNER_DSN" -f database/roles.sql
python api/tools/make_token.py jane editor          # add the printed entry to tokens.json
DATABASE_URL=postgresql://pdm_api:***@localhost/plantdata \
PDM_API_TOKENS_FILE=tokens.json \
.venv/bin/uvicorn pdm_api.main:create_app --factory --app-dir api
```

Optional settings for the document library:

| Variable | Default | Meaning |
|---|---|---|
| `PDM_DOCUMENT_STORAGE` | `db` | `db` (PostgreSQL) or `fs` (disk) for new uploads |
| `PDM_DOCUMENT_ROOT` | — | Directory for `fs` storage (required when `fs`) |
| `PDM_DOCUMENT_MAX_MB` | `25` | Largest accepted file. Behind a reverse proxy, allow at least this request body size (e.g. nginx `client_max_body_size 26m`). |

## Testing

```bash
.venv/bin/pip install -r api/requirements-dev.txt
cd api && PDM_TEST_ADMIN_DSN=postgresql://postgres@localhost/postgres ../.venv/bin/python -m pytest -q
```

The suite builds a seeded template database once, then gives each test a fresh copy. The tests connect
as the least-privilege `pdm_api` role. One of them rebuilds all 172 plants from API responses and
compares each against its structured JSON.
