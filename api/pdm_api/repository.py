"""
Data access and serialisation.

Every row is returned as

    {
      "id", "position",
      "origin":   "legacy" | "app",         # legacy = imported; app = created in the new system
      "current":  {...editable values...},  # what the application reads and edits
      "original": {...legacy values...},    # from the immutable `source` column; null for app rows
      "modified_fields": [...],             # fields where current != original
      "derived":  {...},                    # read-only computed columns (if any)
      "created_at", "updated_at"
    }
"""
import re
from datetime import datetime

import psycopg
from fastapi import HTTPException
from psycopg import sql

from .collections import PLANT_COLLECTIONS, Collection

API_PREFIX = "/api/v1"


class NotFound(HTTPException):
    def __init__(self, what: str):
        super().__init__(404, f"{what} not found")


def unprocessable(msg: str) -> HTTPException:
    return HTTPException(422, msg)


# ------------------------------------------------------------------ modules
# Same rule as database/seed/seed_from_json.py: <int> | <int>(<type>) | <int> (<type>) | <int> <type>
MODULE_RE = re.compile(r"^\s*(\d+)\s*(?:\(\s*(.*?)\s*\)|([^()]*?))\s*$")


def parse_module(value: str | None) -> tuple[int | None, str | None]:
    if value is None:
        return None, None
    m = MODULE_RE.match(value)
    if not m:
        return None, None
    typ = m.group(2) if m.group(2) is not None else m.group(3)
    return int(m.group(1)), (typ or None)


# ------------------------------------------------------------------ serialisation
def _envelope(row: dict, current: dict, original: dict | None, derived: dict | None = None) -> dict:
    modified = [] if original is None else [k for k in current if k in original and current[k] != original[k]]
    out = {
        "id": row["id"],
        "origin": "legacy" if row.get("source") is not None else "app",
        "current": current,
        "original": original,
        "modified_fields": modified,
    }
    if "position" in row:
        out = {"id": row["id"], "position": row["position"], **{k: v for k, v in out.items() if k != "id"}}
    if derived:
        out["derived"] = derived
    out["created_at"] = row["created_at"]
    out["updated_at"] = row["updated_at"]
    return out


def serialize_item(coll: Collection, row: dict, children: list[dict] | None = None) -> dict:
    current = {f.name: row[f.name] for f in coll.fields}
    original = None
    if row.get("source") is not None:
        src = row["source"]
        original = {f.name: src.get(f.src) for f in coll.fields}
        original.update({k: src.get(k) for k in coll.original_extra})
    out = _envelope(row, current, original, {k: row[k] for k in coll.derived})
    if coll.child is not None:
        out[coll.child_key] = [serialize_item(coll.child, c) for c in (children or [])]
    return out


def serialize_module(row: dict) -> dict:
    current = {"value_text": row["value_text"], "quantity": row["quantity"], "module_type": row["module_type"]}
    original = None
    if row["source"] is not None:
        qty, typ = parse_module(row["source_value"])
        original = {"value_text": row["source_value"], "quantity": qty, "module_type": typ}
    out = _envelope(row, current, original)
    return {"stage": "total" if row["is_total"] else row["stage"], **out}


def serialize_plant_core(row: dict) -> dict:
    current = {
        "name": row["name"], "display_name": row["display_name"], "serial_number": row["serial_number"],
        "capacity": row["capacity"], "site_contact_number": row["site_contact_number"],
        "zone_id": row["zone_id"], "zone_name": row["zone_name"],
    }
    original = None
    if row["source"] is not None:
        s = row["source"]
        original = {
            "name": s["plant"]["name"], "display_name": s["source"]["dropdown_label"],
            "serial_number": s["plant"]["serial_number"], "capacity": s["plant"]["capacity"],
            "site_contact_number": s["plant"]["site_contact_number"], "zone_name": s["zone"],
        }
    out = _envelope(row, current, original)
    return {"id": row["id"], "legacy_plant_id": row["legacy_plant_id"], **{k: v for k, v in out.items() if k != "id"}}


# ------------------------------------------------------------------ plants
PLANT_SELECT = """
    SELECT p.*, z.name AS zone_name
    FROM plants p LEFT JOIN zones z ON z.id = p.zone_id
"""


def fetch_plant_row(conn, plant_id: int, lock: bool = False) -> dict:
    row = conn.execute(PLANT_SELECT + " WHERE p.id = %s" + (" FOR UPDATE OF p" if lock else ""),
                       (plant_id,)).fetchone()
    if row is None:
        raise NotFound(f"Plant {plant_id}")
    return row


def ensure_zone(conn, zone_id: int | None):
    if zone_id is not None and conn.execute("SELECT 1 FROM zones WHERE id = %s", (zone_id,)).fetchone() is None:
        raise unprocessable(f"zone_id {zone_id} does not exist")


def plant_document(conn, plant_id: int) -> dict:
    row = fetch_plant_row(conn, plant_id)
    doc = serialize_plant_core(row)
    sections = {r["section"]: r for r in conn.execute(
        "SELECT section, rendered_in_legacy, legacy_count FROM plant_sections WHERE plant_id = %s", (plant_id,))}
    doc["modules"] = [serialize_module(r) for r in conn.execute(
        "SELECT * FROM plant_modules WHERE plant_id = %s ORDER BY position", (plant_id,))]
    doc["sections"] = {}
    for coll in PLANT_COLLECTIONS:
        sec = sections.get(coll.section)
        doc["sections"][coll.section] = {
            "title": coll.title,
            "endpoint": f"{API_PREFIX}/plants/{plant_id}/{coll.slug}",
            "legacy": None if sec is None else {"rendered": sec["rendered_in_legacy"], "count": sec["legacy_count"]},
            "items": list_items(conn, coll, plant_id),
        }
    doc["documents"] = conn.execute(
        "SELECT count(*) AS n FROM plant_documents WHERE plant_id = %s", (plant_id,)).fetchone()["n"]
    doc["links"] = {
        "self": f"{API_PREFIX}/plants/{plant_id}",
        "legacy_snapshot": f"{API_PREFIX}/plants/{plant_id}/legacy",
        "history": f"{API_PREFIX}/plants/{plant_id}/history",
        "documents": f"{API_PREFIX}/plants/{plant_id}/documents",
    }
    return doc


def plant_counts_sql() -> str:
    parts = [f"(SELECT count(*) FROM {c.table} t WHERE t.plant_id = p.id) AS \"{c.section}\""
             for c in PLANT_COLLECTIONS]
    return ", ".join(parts)


def like_pattern(s: str) -> str:
    """A LIKE/ILIKE "contains" pattern with the wildcards in `s` escaped."""
    return "%" + s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


SORTS = {
    "legacy_plant_id": "p.legacy_plant_id NULLS LAST, p.id",
    "name": "lower(p.name), p.id",
    "serial_number": "p.serial_number NULLS LAST, p.id",
    "zone": "z.name NULLS LAST, lower(p.name), p.id",
    "updated_at": "p.updated_at, p.id",
}


def search_plants(conn, *, q=None, zone_id=None, zone=None, serial_number=None, legacy_plant_id=None,
                  origin=None, modified=None, equipment=None, sort="legacy_plant_id", limit=50, offset=0):
    where, args = [], []
    if q:
        where.append("(p.name ILIKE %s OR p.display_name ILIKE %s OR p.serial_number ILIKE %s)")
        args += [like_pattern(q)] * 3
    if zone_id is not None:
        where.append("p.zone_id = %s"); args.append(zone_id)
    if zone:
        where.append("lower(z.name) = lower(%s)"); args.append(zone)
    if serial_number:
        where.append("p.serial_number = %s"); args.append(serial_number)
    if legacy_plant_id is not None:
        where.append("p.legacy_plant_id = %s"); args.append(legacy_plant_id)
    if origin == "legacy":
        where.append("p.legacy_plant_id IS NOT NULL")
    elif origin == "app":
        where.append("p.legacy_plant_id IS NULL")
    if modified is not None:
        where.append(("" if modified else "NOT ") + "EXISTS (SELECT 1 FROM change_log c WHERE c.plant_id = p.id)")
    if equipment:
        pat = like_pattern(equipment)
        subs = []
        for c in PLANT_COLLECTIONS:
            cols = [f for f in c.field_names if f not in ("value", "unit", "motor_kw", "motor_amp", "parameter_name")]
            if c.slug == "design-parameters" or not cols:
                continue
            cond = " OR ".join(f"t.{col} ILIKE %s" for col in cols)
            subs.append(f"EXISTS (SELECT 1 FROM {c.table} t WHERE t.plant_id = p.id AND ({cond}))")
            args += [pat] * len(cols)
        where.append("(" + " OR ".join(subs) + ")")
    desc = sort.startswith("-")
    key = sort.lstrip("-")
    if key not in SORTS:
        raise unprocessable(f"sort must be one of {sorted(SORTS)} (prefix '-' for descending)")
    order = SORTS[key] if not desc else ", ".join(
        part.replace(" NULLS LAST", "") + " DESC NULLS LAST" for part in SORTS[key].split(", "))
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    base = " FROM plants p LEFT JOIN zones z ON z.id = p.zone_id" + where_sql
    total = conn.execute("SELECT count(*) AS n" + base, args).fetchone()["n"]
    rows = conn.execute(
        f"""SELECT p.id, p.legacy_plant_id, p.name, p.display_name, p.serial_number, p.capacity,
                   p.site_contact_number, p.zone_id, z.name AS zone_name, p.created_at, p.updated_at,
                   (p.legacy_plant_id IS NOT NULL) AS is_legacy,
                   EXISTS (SELECT 1 FROM change_log c WHERE c.plant_id = p.id) AS has_changes,
                   (SELECT count(*) FROM plant_documents d WHERE d.plant_id = p.id) AS document_count,
                   {plant_counts_sql()}
            {base} ORDER BY {order} LIMIT %s OFFSET %s""", args + [limit, offset]).fetchall()
    items = []
    for r in rows:
        items.append({
            "id": r["id"], "legacy_plant_id": r["legacy_plant_id"],
            "origin": "legacy" if r["is_legacy"] else "app",
            "name": r["name"], "display_name": r["display_name"], "serial_number": r["serial_number"],
            "capacity": r["capacity"], "site_contact_number": r["site_contact_number"],
            "zone": None if r["zone_id"] is None else {"id": r["zone_id"], "name": r["zone_name"]},
            "has_changes": r["has_changes"],
            "documents": r["document_count"],
            "counts": {c.section: r[c.section] for c in PLANT_COLLECTIONS},
            "created_at": r["created_at"], "updated_at": r["updated_at"],
            "href": f"{API_PREFIX}/plants/{r['id']}",
        })
    return {"items": items, "total": total, "limit": limit, "offset": offset}


# ------------------------------------------------------------------ generic ordered collections
def _t(name: str) -> sql.Identifier:
    return sql.Identifier(name)


def ensure_parent(conn, coll: Collection, plant_id: int, parent_id: int, lock: bool = False):
    """For plant-level collections parent_id == plant_id. For nested collections the parent
    (a filter or accessory group) must belong to the plant."""
    suffix = sql.SQL(" FOR UPDATE") if lock else sql.SQL("")
    if coll.parent_table == "plants":
        fetch_plant_row(conn, plant_id, lock=lock)
        return
    fetch_plant_row(conn, plant_id)
    row = conn.execute(sql.SQL("SELECT id FROM {} WHERE id = %s AND plant_id = %s").format(_t(coll.parent_table))
                       + suffix, (parent_id, plant_id)).fetchone()
    if row is None:
        raise NotFound(f"{coll.parent_table} {parent_id} of plant {plant_id}")


def _children_by_parent(conn, coll: Collection, parent_ids: list[int]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = {i: [] for i in parent_ids}
    if coll.child is None or not parent_ids:
        return out
    c = coll.child
    for r in conn.execute(sql.SQL("SELECT * FROM {} WHERE {} = ANY(%s) ORDER BY {}, position").format(
            _t(c.table), _t(c.parent_fk), _t(c.parent_fk)), (parent_ids,)):
        out[r[c.parent_fk]].append(r)
    return out


def list_items(conn, coll: Collection, parent_id: int) -> list[dict]:
    rows = conn.execute(sql.SQL("SELECT * FROM {} WHERE {} = %s ORDER BY position").format(
        _t(coll.table), _t(coll.parent_fk)), (parent_id,)).fetchall()
    kids = _children_by_parent(conn, coll, [r["id"] for r in rows])
    return [serialize_item(coll, r, kids.get(r["id"])) for r in rows]


def fetch_item_row(conn, coll: Collection, parent_id: int, item_id: int, lock: bool = False) -> dict:
    q = sql.SQL("SELECT * FROM {} WHERE id = %s AND {} = %s").format(_t(coll.table), _t(coll.parent_fk))
    if lock:
        q += sql.SQL(" FOR UPDATE")
    row = conn.execute(q, (item_id, parent_id)).fetchone()
    if row is None:
        raise NotFound(f"{coll.title} {item_id}")
    return row


def get_item(conn, coll: Collection, parent_id: int, item_id: int) -> dict:
    row = fetch_item_row(conn, coll, parent_id, item_id)
    kids = _children_by_parent(conn, coll, [row["id"]])
    return serialize_item(coll, row, kids.get(row["id"]))


def _count(conn, coll: Collection, parent_id: int) -> int:
    return conn.execute(sql.SQL("SELECT count(*) AS n FROM {} WHERE {} = %s").format(
        _t(coll.table), _t(coll.parent_fk)), (parent_id,)).fetchone()["n"]


def insert_item(conn, coll: Collection, parent_id: int, values: dict, position: int | None) -> int:
    n = _count(conn, coll, parent_id)
    pos = n + 1 if position is None else position
    if not 1 <= pos <= n + 1:
        raise unprocessable(f"position must be between 1 and {n + 1}")
    # Unique (parent, position) is DEFERRABLE, so a single-statement shift is allowed.
    conn.execute(sql.SQL("UPDATE {} SET position = position + 1 WHERE {} = %s AND position >= %s").format(
        _t(coll.table), _t(coll.parent_fk)), (parent_id, pos))
    cols = [coll.parent_fk, "position", *values.keys()]
    row = conn.execute(sql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING id").format(
        _t(coll.table), sql.SQL(", ").join(map(_t, cols)), sql.SQL(", ").join(sql.Placeholder() * len(cols))),
        [parent_id, pos, *values.values()]).fetchone()
    return row["id"]


def check_expected(row: dict, expected: datetime | None):
    if expected is not None and row["updated_at"] != expected:
        raise HTTPException(409, {
            "message": "The row was modified by someone else; reload and retry.",
            "current_updated_at": row["updated_at"].isoformat(),
        })


def update_row(conn, table: str, row_id: int, values: dict):
    conn.execute(sql.SQL("UPDATE {} SET {} WHERE id = %s").format(
        _t(table), sql.SQL(", ").join(sql.SQL("{} = %s").format(_t(k)) for k in values)),
        [*values.values(), row_id])


def delete_item(conn, coll: Collection, parent_id: int, item_id: int):
    row = fetch_item_row(conn, coll, parent_id, item_id, lock=True)
    conn.execute(sql.SQL("DELETE FROM {} WHERE id = %s").format(_t(coll.table)), (item_id,))
    conn.execute(sql.SQL("UPDATE {} SET position = position - 1 WHERE {} = %s AND position > %s").format(
        _t(coll.table), _t(coll.parent_fk)), (parent_id, row["position"]))


def reorder(conn, coll: Collection, parent_id: int, ids: list[int]):
    current = [r["id"] for r in conn.execute(sql.SQL("SELECT id FROM {} WHERE {} = %s ORDER BY position").format(
        _t(coll.table), _t(coll.parent_fk)), (parent_id,))]
    if len(ids) != len(set(ids)):
        raise unprocessable("ids contains duplicates")
    if set(ids) != set(current):
        missing, unknown = sorted(set(current) - set(ids)), sorted(set(ids) - set(current))
        raise unprocessable(f"ids must list every item exactly once (missing: {missing}, unknown: {unknown})")
    conn.execute(sql.SQL("""UPDATE {t} SET position = v.ord
                            FROM unnest(%s::bigint[]) WITH ORDINALITY AS v(id, ord)
                            WHERE {t}.id = v.id AND {t}.position <> v.ord""").format(t=_t(coll.table)), (ids,))


# ------------------------------------------------------------------ legacy + history
def legacy_snapshot(conn, plant_id: int) -> dict:
    row = fetch_plant_row(conn, plant_id)
    recs = conn.execute(
        """SELECT r.id, r.legacy_plant_id, r.raw_file, r.raw_sha256, r.metadata_file, r.endpoint,
                  r.http_status, r.imported_at, r.record,
                  b.id AS batch_id, b.source_path, b.schema_version, b.imported_at AS batch_imported_at
           FROM legacy_plant_records r JOIN import_batches b ON b.id = r.import_batch_id
           WHERE r.plant_id = %s ORDER BY r.id""", (plant_id,)).fetchall()
    return {
        "plant_id": plant_id,
        "legacy_plant_id": row["legacy_plant_id"],
        "immutable": True,
        "records": [{
            "id": r["id"],
            "import_batch": {"id": r["batch_id"], "source_path": r["source_path"],
                             "schema_version": r["schema_version"], "imported_at": r["batch_imported_at"]},
            "raw_file": r["raw_file"], "raw_sha256": r["raw_sha256"], "metadata_file": r["metadata_file"],
            "endpoint": r["endpoint"], "http_status": r["http_status"], "imported_at": r["imported_at"],
            "record": r["record"],
        } for r in recs],
    }


def history(conn, plant_id: int, limit: int, offset: int, request_id: str | None = None) -> dict:
    fetch_plant_row(conn, plant_id)
    where, args = "plant_id = %s", [plant_id]
    if request_id:
        where += " AND request_id = %s"; args.append(request_id)
    total = conn.execute(f"SELECT count(*) AS n FROM change_log WHERE {where}", args).fetchone()["n"]
    rows = conn.execute(f"""SELECT id, table_name, row_id, operation, column_name, old_value, new_value,
                                   old_row, new_row, changed_by, reason, request_id, changed_at
                            FROM change_log WHERE {where} ORDER BY id DESC LIMIT %s OFFSET %s""",
                        args + [limit, offset]).fetchall()
    return {"items": rows, "total": total, "limit": limit, "offset": offset}
