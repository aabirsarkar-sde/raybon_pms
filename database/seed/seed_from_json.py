"""
Import plantdata_export/structured/plant_*.json into the PostgreSQL schema in
database/schema.sql, then verify the import by rebuilding every JSON record
from the database and comparing it to the source file.

The source files are only read, never written.

Usage:
    python database/seed/seed_from_json.py --dsn postgresql://user@host/db [--apply-schema]
    python database/seed/seed_from_json.py --dsn ... --verify-only

DSN may also come from the DATABASE_URL environment variable.

The import runs in a single transaction. It refuses to run if any legacy
plant already exists in the database, so it never overwrites corrections.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[2]
EXPORT_DIR = ROOT / "plantdata_export"
STRUCTURED_DIR = EXPORT_DIR / "structured"
SCHEMA_SQL = ROOT / "database" / "schema.sql"
MIGRATIONS_DIR = ROOT / "database" / "migrations"

STAGE_FIELDS = ["stage_1", "stage_2", "stage_3", "stage_4", "stage_5"]

# JSON section key -> (table, plant_sections.section, [(json field, column)])
SIMPLE_EQUIPMENT = {
    "pump_and_motor": ("pumps_and_motors", "pumps_and_motors", [
        ("pump_code", "equipment_code"), ("pump_make", "pump_make"), ("pump_model", "pump_model"),
        ("motor_make", "motor_make"), ("motor_kw", "motor_kw"), ("motor_amp", "motor_amp")]),
    "instruments": ("instruments", "instruments", [("name", "name"), ("make", "make"), ("model", "model")]),
    "hmi_and_plc": ("hmi_plc", "hmi_plc", [("name", "name"), ("make", "make"), ("model", "model")]),
    "vfd": ("vfds", "vfds", [("name", "name"), ("make", "make"), ("model", "model")]),
    "dosing_pumps": ("dosing_pumps", "dosing_pumps", [
        ("dosing_pump_for", "dosing_pump_for"), ("make", "make"), ("model", "model")]),
}
SECTION_NAMES = {  # JSON section key -> plant_sections.section
    "design_parameters": "design_parameters",
    **{k: v[1] for k, v in SIMPLE_EQUIPMENT.items()},
    "hp_pump_accessories": "hp_pump_accessories",
    "filters": "filters",
}

MODULE_RE = re.compile(r"^\s*(\d+)\s*(?:\(\s*(.*?)\s*\)|([^()]*?))\s*$")


def parse_module(value):
    """'3(HPRO)' -> (3, 'HPRO'); '2 (ST)' -> (2, 'ST'); '1 PT' -> (1, 'PT'); '0' -> (0, None).
    Anything else -> (None, None); the text itself is always kept separately."""
    if value is None:
        return None, None
    m = MODULE_RE.match(value)
    if not m:
        return None, None
    typ = m.group(2) if m.group(2) is not None else m.group(3)
    return int(m.group(1)), (typ or None)


def load_records():
    files = sorted(STRUCTURED_DIR.glob("plant_*.json"), key=lambda p: int(p.stem.split("_")[1]))
    return [(f, json.loads(f.read_text(encoding="utf-8"))) for f in files]


def sha256_of(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None


# ============================================================================ import
def insert_plant(cur, batch_id, zone_ids, rec):
    p, src = rec["plant"], rec["source"]
    cur.execute(
        """INSERT INTO plants (legacy_plant_id, name, display_name, serial_number, capacity,
                               site_contact_number, zone_id, source)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (rec["plant_id"], p["name"], src["dropdown_label"], p["serial_number"], p["capacity"],
         p["site_contact_number"], zone_ids.get(rec["zone"]),
         Jsonb({"source": src, "plant": p, "zone": rec["zone"], "modules": rec["modules"]})))
    plant_id = cur.fetchone()[0]

    raw_path = EXPORT_DIR / src["raw_file"]
    cur.execute(
        """INSERT INTO legacy_plant_records (import_batch_id, plant_id, legacy_plant_id, record, raw_file,
                                             raw_sha256, metadata_file, endpoint, http_status)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (batch_id, plant_id, rec["plant_id"], Jsonb(rec), src["raw_file"], sha256_of(raw_path),
         src["metadata_file"], src["endpoint"], src["http_status"]))

    # sections: rendered? + legacy counter
    cur.executemany(
        """INSERT INTO plant_sections (plant_id, section, rendered_in_legacy, legacy_count)
           VALUES (%s, %s, %s, %s)""",
        [(plant_id, sec, rec[key] is not None, rec["legacy_counts"].get(key))
         for key, sec in SECTION_NAMES.items()])

    # modules
    rows = []
    for i, field in enumerate(STAGE_FIELDS + ["total"], start=1):
        v = rec["modules"][field]
        qty, typ = parse_module(v)
        is_total = field == "total"
        rows.append((plant_id, i, None if is_total else i, is_total, v, qty, typ, v,
                     Jsonb({"field": field, "value": v})))
    cur.executemany(
        """INSERT INTO plant_modules (plant_id, position, stage, is_total, value_text, quantity,
                                      module_type, source_value, source)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""", rows)

    # design parameters
    cur.executemany(
        """INSERT INTO plant_design_parameters (plant_id, position, parameter_name, value, unit,
                                                source_value, source)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        [(plant_id, d["position"], d["name"], d["value"], d["unit"], d["value"], Jsonb(d))
         for d in rec["design_parameters"] or []])

    # table-shaped equipment
    for key, (table, _, cols) in SIMPLE_EQUIPMENT.items():
        rows = [(plant_id, pos, *[r[f] for f, _ in cols], Jsonb(r))
                for pos, r in enumerate(rec[key] or [], start=1)]
        if rows:
            col_sql = ", ".join(c for _, c in cols)
            ph = ", ".join(["%s"] * (len(cols) + 3))
            cur.executemany(f"INSERT INTO {table} (plant_id, position, {col_sql}, source) VALUES ({ph})", rows)

    # filters + ordered unlabelled values
    for f in rec["filters"] or []:
        cur.execute("INSERT INTO filters (plant_id, position, name, source) VALUES (%s, %s, %s, %s) RETURNING id",
                    (plant_id, f["position"], f["name"], Jsonb(f)))
        fid = cur.fetchone()[0]
        cur.executemany(
            "INSERT INTO filter_values (filter_id, position, value, source_value, source) VALUES (%s, %s, %s, %s, %s)",
            [(fid, i, v, v, Jsonb({"value": v})) for i, v in enumerate(f["values"], start=1)])

    # HP pump accessories: groups + label/value entries
    for g in rec["hp_pump_accessories"] or []:
        cur.execute(
            "INSERT INTO hp_pump_accessory_groups (plant_id, position, group_name, source) VALUES (%s, %s, %s, %s) RETURNING id",
            (plant_id, g["position"], g["group"], Jsonb(g)))
        gid = cur.fetchone()[0]
        cur.executemany(
            "INSERT INTO hp_pump_accessory_entries (group_id, position, label, value, source) VALUES (%s, %s, %s, %s, %s)",
            [(gid, i, e["label"], e["value"], Jsonb(e)) for i, e in enumerate(g["entries"], start=1)])


def run_import(conn, records):
    with conn.transaction(), conn.cursor() as cur:
        # The import itself is recorded in import_batches; don't log every INSERT.
        cur.execute("SET LOCAL pdm.bulk_import = 'on'")
        cur.execute("SELECT count(*) FROM plants WHERE legacy_plant_id IS NOT NULL")
        existing = cur.fetchone()[0]
        if existing:
            sys.exit(f"Refusing to import: {existing} legacy plants already in the database.")

        versions = {r["schema_version"] for _, r in records}
        if len(versions) != 1:
            sys.exit(f"Mixed schema versions in structured JSON: {versions}")
        cur.execute(
            """INSERT INTO import_batches (source_path, schema_version, record_count, notes)
               VALUES (%s, %s, %s, %s) RETURNING id""",
            (str(STRUCTURED_DIR.relative_to(ROOT)), versions.pop(), len(records),
             "Initial import of legacy PlantData export"))
        batch_id = cur.fetchone()[0]

        zones = sorted({r["zone"] for _, r in records if r["zone"] is not None})
        cur.executemany("INSERT INTO zones (name) VALUES (%s) ON CONFLICT (name) DO NOTHING", [(z,) for z in zones])
        cur.execute("SELECT name, id FROM zones")
        zone_ids = dict(cur.fetchall())

        for i, (_, rec) in enumerate(records, 1):
            print(f"Importing {i}/{len(records)}: {rec['plant']['name']}", flush=True)
            insert_plant(cur, batch_id, zone_ids, rec)
    return batch_id


# ============================================================================ verify
def rebuild(cur, plant_db_id):
    """Rebuild the structured JSON record from the working tables."""
    q = lambda sql: (cur.execute(sql, (plant_db_id,)), cur.fetchall())[1]

    (lpid, name, display, serial, cap, contact, zone), = q(
        """SELECT p.legacy_plant_id, p.name, p.display_name, p.serial_number, p.capacity,
                  p.site_contact_number, z.name
           FROM plants p LEFT JOIN zones z ON z.id = p.zone_id WHERE p.id = %s""")
    (lrec,), = q("""SELECT jsonb_build_object('raw_file', raw_file, 'metadata_file', metadata_file,
                                             'endpoint', endpoint, 'http_status', http_status,
                                             'schema_version', record->>'schema_version')
                    FROM legacy_plant_records WHERE plant_id = %s""")
    sections = {s: (rendered, cnt) for s, rendered, cnt in
                q("SELECT section, rendered_in_legacy, legacy_count FROM plant_sections WHERE plant_id = %s")}

    def section(key, rows):
        return rows if sections[SECTION_NAMES[key]][0] else None

    modules = {("total" if tot else f"stage_{st}"): v for st, tot, v in
               q("SELECT stage, is_total, value_text FROM plant_modules WHERE plant_id = %s ORDER BY position")}

    dps = [{"position": pos, "name": n, "unit": u, "unit_raw": s.get("unit_raw"), "value": v}
           for pos, n, u, v, s in q("""SELECT position, parameter_name, unit, value, source
                                       FROM plant_design_parameters WHERE plant_id = %s ORDER BY position""")]

    rec = {
        "schema_version": lrec["schema_version"],
        "plant_id": lpid,
        "source": {"raw_file": lrec["raw_file"], "metadata_file": lrec["metadata_file"],
                   "endpoint": lrec["endpoint"], "http_status": lrec["http_status"], "dropdown_label": display},
        "plant": {"name": name, "serial_number": serial, "capacity": cap, "site_contact_number": contact},
        "zone": zone,
        "modules": modules,
        "design_parameters": section("design_parameters", dps),
    }
    for key, (table, _, cols) in SIMPLE_EQUIPMENT.items():
        col_sql = ", ".join(c for _, c in cols)
        rows = [dict(zip([f for f, _ in cols], r)) for r in
                q(f"SELECT {col_sql} FROM {table} WHERE plant_id = %s ORDER BY position")]
        rec[key] = section(key, rows)

    groups = []
    for gid, pos, gname in q("SELECT id, position, group_name FROM hp_pump_accessory_groups WHERE plant_id = %s ORDER BY position"):
        cur.execute("SELECT label, value FROM hp_pump_accessory_entries WHERE group_id = %s ORDER BY position", (gid,))
        groups.append({"position": pos, "group": gname,
                       "entries": [{"label": l, "value": v} for l, v in cur.fetchall()]})
    rec["hp_pump_accessories"] = section("hp_pump_accessories", groups)

    filters = []
    for fid, pos, fname in q("SELECT id, position, name FROM filters WHERE plant_id = %s ORDER BY position"):
        cur.execute("SELECT value FROM filter_values WHERE filter_id = %s ORDER BY position", (fid,))
        filters.append({"position": pos, "name": fname, "values": [v for (v,) in cur.fetchall()]})
    rec["filters"] = section("filters", filters)

    rec["legacy_counts"] = {key: sections[sec][1] for key, sec in SECTION_NAMES.items() if key != "design_parameters"}
    return rec


def diff(a, b, path="$"):
    if type(a) is not type(b):
        return [f"{path}: {a!r} != {b!r}"]
    if isinstance(a, dict):
        out = [f"{path}.{k}: key missing on one side" for k in set(a) ^ set(b)]
        for k in a.keys() & b.keys():
            out += diff(a[k], b[k], f"{path}.{k}")
        return out
    if isinstance(a, list):
        if len(a) != len(b):
            return [f"{path}: length {len(a)} != {len(b)}"]
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in diff(x, y, f"{path}[{i}]")]
    return [] if a == b else [f"{path}: {a!r} != {b!r}"]


def verify(conn, records):
    problems = {}
    with conn.cursor() as cur:
        cur.execute("SELECT legacy_plant_id, id FROM plants WHERE legacy_plant_id IS NOT NULL")
        ids = dict(cur.fetchall())
        for f, rec in records:
            if rec["plant_id"] not in ids:
                problems[f.name] = ["not in database"]
                continue
            d = diff(rec, rebuild(cur, ids[rec["plant_id"]]))
            # the immutable snapshot must also equal the file exactly
            cur.execute("SELECT record FROM legacy_plant_records WHERE plant_id = %s", (ids[rec["plant_id"]],))
            d += [f"snapshot {x}" for x in diff(rec, cur.fetchone()[0])]
            if d:
                problems[f.name] = d
        extra = set(ids) - {r["plant_id"] for _, r in records}

        counts = {}
        for t in ["plants", "zones", "legacy_plant_records", "plant_sections", "plant_modules",
                  "plant_design_parameters", "pumps_and_motors", "instruments", "hmi_plc", "vfds",
                  "dosing_pumps", "filters", "filter_values", "hp_pump_accessory_groups",
                  "hp_pump_accessory_entries"]:
            cur.execute(f"SELECT count(*) FROM {t}")
            counts[t] = cur.fetchone()[0]
    return problems, extra, counts


# ============================================================================ main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dsn", default=os.environ.get("DATABASE_URL"))
    ap.add_argument("--apply-schema", action="store_true", help="run database/schema.sql first (empty database)")
    ap.add_argument("--verify-only", action="store_true", help="skip import; only verify")
    args = ap.parse_args()
    if not args.dsn:
        sys.exit("Provide --dsn or set DATABASE_URL")

    records = load_records()
    print(f"Loaded {len(records)} structured records from {STRUCTURED_DIR.relative_to(ROOT)}")

    with psycopg.connect(args.dsn) as conn:
        if args.apply_schema:
            conn.execute(SCHEMA_SQL.read_text(encoding="utf-8"))
            for m in sorted(MIGRATIONS_DIR.glob("*.sql")):
                conn.execute(m.read_text(encoding="utf-8"))
                print(f"Applied migration {m.name}")
            conn.commit()
            print("Applied schema.sql")
        if not args.verify_only:
            batch = run_import(conn, records)
            print(f"Imported {len(records)} plants (import batch {batch})")

        problems, extra, counts = verify(conn, records)
    for t, n in counts.items():
        print(f"  {t:28} {n:6}")
    if extra:
        print(f"Legacy plants in DB but not in JSON: {sorted(extra)}")
    if problems:
        print(f"VERIFY FAILED for {len(problems)} plant(s):")
        for name, ds in list(problems.items())[:20]:
            print(f"  {name}: {ds[:5]}")
        sys.exit(1)
    print(f"Verified: all {len(records)} plants rebuild from the database identical to their JSON files.")


if __name__ == "__main__":
    main()
