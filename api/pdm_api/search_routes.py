"""Cross-plant equipment search: "which plants have this pump model, by zone?"."""
from typing import Optional

import psycopg
from fastapi import APIRouter, Depends, Query

from . import equipment
from .auth import require
from .db import get_conn, read_tx
from .repository import API_PREFIX

router = APIRouter(prefix=API_PREFIX)

Viewer = Depends(require("viewer"))


@router.get("/equipment/kinds", tags=["equipment"], dependencies=[Viewer])
def list_kinds():
    """The equipment lists that can be searched, and what `type` means in each."""
    return {"items": [{"kind": k.key, "label": k.label, "type_label": k.type_label, "slug": k.slug,
                       "section": k.section, "has_make": k.has_make, "has_model": k.has_model}
                      for k in equipment.KINDS]}


@router.get("/equipment/search", tags=["equipment"], dependencies=[Viewer])
def search_equipment(
    conn: psycopg.Connection = Depends(get_conn),
    q: Optional[str] = Query(None, max_length=200,
                             description="Matches any make, model, name or value, e.g. 'CRN 10-15'"),
    kind: Optional[list[str]] = Query(None, description="Repeatable; see GET /equipment/kinds"),
    make: Optional[list[str]] = Query(None, description="Repeatable, case-insensitive exact match"),
    model: Optional[list[str]] = Query(None, description="Repeatable, case-insensitive exact match"),
    type: Optional[list[str]] = Query(None, alias="type",  # noqa: A002  (the API's field name)
                                      description="Repeatable, case-insensitive exact match"),
    zone_id: Optional[list[int]] = Query(None, description="Repeatable: one, two or many zones"),
    zone: Optional[list[str]] = Query(None, description="Repeatable zone names, case-insensitive"),
    unzoned: bool = Query(False, description="Also include plants with no zone"),
    sort: str = Query("items", description="Plant order: items | name | zone | legacy_plant_id"),
    limit: int = Query(25, ge=1, le=200, description="Plants per page"),
    offset: int = Query(0, ge=0),
    matches: int = Query(25, ge=0, le=200, description="Matching rows listed per plant"),
    facet_limit: int = Query(300, ge=0, le=2000, description="Values per make/model/type facet"),
):
    """
    How many plants have a given piece of equipment, and where.

    `summary` and `plants` honour every filter. The `zones`, `kinds` and `facets`
    breakdowns each ignore their own filter, so choosing one zone (or make, or
    model) still shows the counts for the alternatives.
    """
    filters = equipment.Filters(q=q, kinds=kind, makes=make, models=model, types=type,
                                zone_ids=zone_id, zone_names=zone, unzoned=unzoned)
    with read_tx(conn):
        return equipment.search(conn, filters, sort=sort, limit=limit, offset=offset,
                                facet_limit=facet_limit, matches_limit=matches)
