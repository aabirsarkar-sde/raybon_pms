"""
Cross-plant equipment search.

Every equipment table names the same three ideas differently — what a row *is*
("Pump Code", "Name", "Dosing Pump For"), who *made* it and which *model* it
is — so each table is projected onto one shape and the projections are
UNION ALL'd into a single searchable set:

    kind      which equipment list the row came from (see KINDS)
    item_id   the row's own id in its table
    plant_id  owning plant
    position  row order within the plant's list
    type      the row's identifying text (pump code, instrument name, chemical…)
    make      manufacturer, where the table records one
    model     model number, where the table records one
    detail    extra values for display, verbatim, as a JSON object
    search    the free-text haystack: every searchable value of the row

`search` exists so free text matches one column instead of a dozen, and so the
keys of `detail` are never searched (q = "kw" must not match every motor).

Results are reported the way a faceted search is expected to behave: each
breakdown ignores its *own* selection, so the zone list still shows every zone's
count after a zone is picked, and the Make list still shows the alternatives
after a Make is picked. Only `summary` and `plants` honour every filter at once.
"""
from dataclasses import dataclass
from typing import Iterable

from fastapi import HTTPException


@dataclass(frozen=True)
class Kind:
    key: str
    label: str
    type_label: str          # what `type` means for this kind, for UI column headers
    slug: str                # collection slug, for deep links into the plant page
    section: str             # plant document / plant_sections key
    has_make: bool
    has_model: bool
    sql: str                 # projection onto (kind, item_id, plant_id, position, type, make, model, detail, search)


# Pumps and motors share one legacy table but are two things to search for, so
# they are projected twice. HMI and PLC share one legacy list and cannot be told
# apart reliably (the legacy rows are named "HMI & PLC", "Module 1", …), so they
# stay one kind; the Type facet narrows within it.
KINDS: tuple[Kind, ...] = (
    Kind(
        "pumps", "Pumps", "Pump code", "pumps-and-motors", "pumps_and_motors", True, True,
        """SELECT 'pumps' AS kind, t.id AS item_id, t.plant_id, t.position,
                  t.equipment_code AS type, t.pump_make AS make, t.pump_model AS model,
                  '{}'::jsonb AS detail,
                  concat_ws(' ', t.equipment_code, t.pump_make, t.pump_model) AS search
           FROM pumps_and_motors t""",
    ),
    Kind(
        "motors", "Motors", "Pump code", "pumps-and-motors", "pumps_and_motors", True, False,
        """SELECT 'motors', t.id, t.plant_id, t.position,
                  t.equipment_code, t.motor_make, NULL::text,
                  jsonb_strip_nulls(jsonb_build_object('motor_kw', t.motor_kw, 'motor_amp', t.motor_amp)),
                  concat_ws(' ', t.equipment_code, t.motor_make, t.motor_kw, t.motor_amp)
           FROM pumps_and_motors t
           WHERE t.motor_make IS NOT NULL OR t.motor_kw IS NOT NULL OR t.motor_amp IS NOT NULL""",
    ),
    Kind(
        "instruments", "Instruments", "Instrument", "instruments", "instruments", True, True,
        """SELECT 'instruments', t.id, t.plant_id, t.position,
                  t.name, t.make, t.model, '{}'::jsonb,
                  concat_ws(' ', t.name, t.make, t.model)
           FROM instruments t""",
    ),
    Kind(
        "hmi_plc", "HMI & PLC", "Item", "hmi-plc", "hmi_plc", True, True,
        """SELECT 'hmi_plc', t.id, t.plant_id, t.position,
                  t.name, t.make, t.model, '{}'::jsonb,
                  concat_ws(' ', t.name, t.make, t.model)
           FROM hmi_plc t""",
    ),
    Kind(
        "vfds", "VFDs", "VFD", "vfds", "vfds", True, True,
        """SELECT 'vfds', t.id, t.plant_id, t.position,
                  t.name, t.make, t.model, '{}'::jsonb,
                  concat_ws(' ', t.name, t.make, t.model)
           FROM vfds t""",
    ),
    Kind(
        "dosing_pumps", "Dosing pumps", "Dosing pump for", "dosing-pumps", "dosing_pumps", True, True,
        """SELECT 'dosing_pumps', t.id, t.plant_id, t.position,
                  t.dosing_pump_for, t.make, t.model, '{}'::jsonb,
                  concat_ws(' ', t.dosing_pump_for, t.make, t.model)
           FROM dosing_pumps t""",
    ),
    Kind(
        "hp_pump_accessories", "HP pump accessories", "Accessory", "hp-pump-accessories",
        "hp_pump_accessories", False, True,
        # One row per accessory entry: the part number is the searchable "model".
        """SELECT 'hp_pump_accessories', e.id, g.plant_id, e.position,
                  coalesce(e.label, g.group_name), NULL::text, e.value,
                  jsonb_strip_nulls(jsonb_build_object('group', g.group_name, 'label', e.label)),
                  concat_ws(' ', g.group_name, e.label, e.value)
           FROM hp_pump_accessory_entries e
           JOIN hp_pump_accessory_groups g ON g.id = e.group_id""",
    ),
    Kind(
        "filters", "Filters", "Filter", "filters", "filters", False, False,
        # The legacy filter rows carry unlabelled values; they are searchable and shown verbatim.
        """SELECT 'filters', t.id, t.plant_id, t.position,
                  t.name, NULL::text, NULL::text,
                  jsonb_strip_nulls(jsonb_build_object('values', v.vals)),
                  concat_ws(' ', t.name, v.txt)
           FROM filters t
           LEFT JOIN LATERAL (
               SELECT jsonb_agg(fv.value ORDER BY fv.position) FILTER (WHERE fv.value IS NOT NULL) AS vals,
                      string_agg(fv.value, ' ' ORDER BY fv.position) AS txt
               FROM filter_values fv WHERE fv.filter_id = t.id) v ON true""",
    ),
)
KIND_BY_KEY = {k.key: k for k in KINDS}

# Equipment list of the projection, in one CTE.
_EQUIPMENT_CTE = "\n        UNION ALL\n".join(f"        ({k.sql})" for k in KINDS)

# Usable both in the query's ORDER BY and inside row_number() OVER (...), so an
# output-column alias such as `items` cannot appear here.
PLANT_SORTS = {
    "items": "count(*) DESC, lower(name), plant_id",
    "name": "lower(name), plant_id",
    "zone": "zone_name NULLS LAST, lower(name), plant_id",
    "legacy_plant_id": "legacy_plant_id NULLS LAST, plant_id",
}

FACET_DIMENSIONS = ("make", "model", "type")


def _like(s: str) -> str:
    return "%" + s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _lower_list(values: Iterable[str]) -> list[str]:
    """De-duplicated, lower-cased selection, so matching is case-insensitive."""
    return sorted({v.strip().lower() for v in values if v and v.strip()})


@dataclass
class Filters:
    q: str | None = None
    kinds: list[str] | None = None
    makes: list[str] | None = None
    models: list[str] | None = None
    types: list[str] | None = None
    zone_ids: list[int] | None = None
    zone_names: list[str] | None = None
    unzoned: bool = False

    def validate(self) -> None:
        unknown = sorted(set(self.kinds or []) - KIND_BY_KEY.keys())
        if unknown:
            raise HTTPException(422, f"Unknown equipment kind(s) {unknown}; "
                                     f"expected any of {sorted(KIND_BY_KEY)}")

    @property
    def zone_selected(self) -> bool:
        return bool(self.zone_ids or self.zone_names or self.unzoned)

    def echo(self) -> dict:
        return {
            "q": self.q, "kind": self.kinds or [], "make": self.makes or [], "model": self.models or [],
            "type": self.types or [],
            "zone_id": self.zone_ids or [], "zone": self.zone_names or [], "unzoned": self.unzoned,
        }


def _flags(f: Filters) -> tuple[list[str], list]:
    """One boolean per filter dimension, carried on every row so each breakdown can
    ignore its own dimension. A dimension with nothing selected is simply true."""
    sql, args = [], []

    def flag(name: str, expr: str | None, params: list):
        sql.append(f"({expr or 'true'}) AS {name}")
        args.extend(params)

    flag("kind_ok", "e.kind = ANY(%s)" if f.kinds else None, [sorted(set(f.kinds))] if f.kinds else [])
    for name, values, col in (("make_ok", f.makes, "e.make"),
                              ("model_ok", f.models, "e.model"),
                              ("type_ok", f.types, "e.type")):
        vals = _lower_list(values or [])
        flag(name, f"lower({col}) = ANY(%s)" if vals else None, [vals] if vals else [])

    if f.zone_selected:
        parts, zargs = [], []
        if f.zone_ids:
            parts.append("p.zone_id = ANY(%s)"); zargs.append(sorted(set(f.zone_ids)))
        if f.zone_names:
            parts.append("lower(z.name) = ANY(%s)"); zargs.append(_lower_list(f.zone_names))
        if f.unzoned:
            parts.append("p.zone_id IS NULL")
        flag("zone_ok", " OR ".join(parts), zargs)
    else:
        flag("zone_ok", None, [])
    return sql, args


# `base` holds every row that matches the free text, each tagged with which of the
# other filters it satisfies. Every breakdown below is a different combination of
# those tags over the same materialised set, so the union is computed once.
_BASE = """
WITH eq AS (
{equipment}
),
base AS MATERIALIZED (
    SELECT e.kind, e.item_id, e.plant_id, e.position, e.type, e.make, e.model, e.detail,
           p.legacy_plant_id, p.name, p.display_name, p.serial_number, p.capacity,
           p.zone_id, z.name AS zone_name,
           {flags}
    FROM eq e
    JOIN plants p ON p.id = e.plant_id
    LEFT JOIN zones z ON z.id = p.zone_id
    {where}
),
hit AS MATERIALIZED (
    SELECT * FROM base WHERE kind_ok AND make_ok AND model_ok AND type_ok AND zone_ok
),
page AS (
    SELECT plant_id, legacy_plant_id, name, display_name, serial_number, capacity, zone_id, zone_name,
           count(*) AS items, row_number() OVER (ORDER BY {order}) AS ord
    FROM hit
    GROUP BY plant_id, legacy_plant_id, name, display_name, serial_number, capacity, zone_id, zone_name
    ORDER BY {order}
    LIMIT %s OFFSET %s
)
"""

# Everything the UI needs, in one round trip and one consistent snapshot.
_PAYLOAD = """
SELECT jsonb_build_object(
    'summary', (SELECT jsonb_build_object(
                    'items', count(*),
                    'plants', count(DISTINCT plant_id),
                    'zones', count(DISTINCT zone_id)) FROM hit),
    'plants_total', (SELECT count(DISTINCT plant_id) FROM hit),
    'plants', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'plant', jsonb_build_object(
                        'id', g.plant_id, 'legacy_plant_id', g.legacy_plant_id, 'name', g.name,
                        'display_name', g.display_name, 'serial_number', g.serial_number,
                        'capacity', g.capacity,
                        'zone', CASE WHEN g.zone_id IS NULL THEN NULL
                                     ELSE jsonb_build_object('id', g.zone_id, 'name', g.zone_name) END),
                    'items', g.items,
                    'matches', (SELECT coalesce(jsonb_agg(m), '[]'::jsonb) FROM (
                        SELECT jsonb_build_object('kind', h.kind, 'id', h.item_id, 'position', h.position,
                                                  'type', h.type, 'make', h.make, 'model', h.model,
                                                  'detail', h.detail) AS m
                        FROM hit h WHERE h.plant_id = g.plant_id
                        ORDER BY h.kind, h.position LIMIT %s) s)
                ) ORDER BY g.ord), '[]'::jsonb) FROM page g),
    -- Zone counts ignore the zone selection, so picking a zone never blanks the others.
    'zones', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'zone', jsonb_build_object('id', z.id, 'name', z.name),
                    'items', coalesce(c.items, 0), 'plants', coalesce(c.plants, 0)
                 ) ORDER BY coalesce(c.items, 0) DESC, z.name), '[]'::jsonb)
              FROM zones z
              LEFT JOIN (SELECT zone_id, count(*) AS items, count(DISTINCT plant_id) AS plants
                         FROM base WHERE kind_ok AND make_ok AND model_ok AND type_ok AND zone_id IS NOT NULL
                         GROUP BY zone_id) c ON c.zone_id = z.id),
    'unzoned', (SELECT jsonb_build_object('items', count(*), 'plants', count(DISTINCT plant_id))
                FROM base WHERE kind_ok AND make_ok AND model_ok AND type_ok AND zone_id IS NULL),
    'kinds', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'kind', kind, 'items', items, 'plants', plants) ORDER BY items DESC, kind), '[]'::jsonb)
              FROM (SELECT kind, count(*) AS items, count(DISTINCT plant_id) AS plants
                    FROM base WHERE make_ok AND model_ok AND type_ok AND zone_ok
                    GROUP BY kind) k),
    'facets', jsonb_build_object({facets})
) AS payload
"""

# Spellings that differ only in case are one option, because selecting one matches
# them all. The commonest spelling is shown, and `spellings` counts the variants —
# "GRUNDFOS / Grundfos / GRUNDFOSE" is worth seeing, but not as three filters.
_FACET = """
        '{dim}', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'value', value, 'items', items, 'plants', plants, 'spellings', spellings
                     ) ORDER BY items DESC, lower(value)), '[]'::jsonb)
                  FROM (SELECT mode() WITHIN GROUP (ORDER BY {dim}) AS value,
                               count(*) AS items, count(DISTINCT plant_id) AS plants,
                               count(DISTINCT {dim}) AS spellings
                        FROM base WHERE {conds} AND {dim} IS NOT NULL
                        GROUP BY lower({dim}) ORDER BY count(*) DESC, lower(mode() WITHIN GROUP (ORDER BY {dim}))
                        LIMIT %s) f)"""


def search(conn, f: Filters, *, sort: str = "items", limit: int = 25, offset: int = 0,
           facet_limit: int = 300, matches_limit: int = 25) -> dict:
    f.validate()
    if sort not in PLANT_SORTS:
        raise HTTPException(422, f"sort must be one of {sorted(PLANT_SORTS)}")

    flags_sql, flag_args = _flags(f)
    where, where_args = "", []
    if f.q:
        where, where_args = "WHERE e.search ILIKE %s", [_like(f.q)]

    facet_sql, facet_args = [], []
    for dim in FACET_DIMENSIONS:
        # Each facet ignores its own dimension (standard faceted-search behaviour).
        conds = " AND ".join(f"{d}_ok" for d in ("kind", "make", "model", "type", "zone") if d != dim)
        facet_sql.append(_FACET.format(dim=dim, conds=conds))
        facet_args.append(facet_limit)

    sql = _BASE.format(equipment=_EQUIPMENT_CTE, flags=",\n           ".join(flags_sql),
                       where=where, order=PLANT_SORTS[sort])
    sql += _PAYLOAD.format(facets=",".join(facet_sql))
    args = [*flag_args, *where_args, limit, offset, matches_limit, *facet_args]

    payload = conn.execute(sql, args).fetchone()["payload"]
    total = payload.pop("plants_total")
    payload["plants"] = {"items": payload["plants"], "total": total, "limit": limit, "offset": offset}
    payload["kinds"] = _with_kind_labels(payload["kinds"])
    payload["filters"] = f.echo()
    payload["sort"] = sort
    payload["facets_truncated"] = sorted(
        dim for dim in FACET_DIMENSIONS if len(payload["facets"][dim]) >= facet_limit)
    return payload


def _with_kind_labels(rows: list[dict]) -> list[dict]:
    """Every kind is listed, including those with no match, so the UI can offer them all."""
    counted = {r["kind"]: r for r in rows}
    return [{"kind": k.key, "label": k.label, "type_label": k.type_label, "slug": k.slug,
             "section": k.section, "has_make": k.has_make, "has_model": k.has_model,
             "items": counted.get(k.key, {}).get("items", 0),
             "plants": counted.get(k.key, {}).get("plants", 0)}
            for k in KINDS]
