from typing import Literal, Optional

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from . import repository as repo
from .auth import current_principal, require
from .collections import PLANT_COLLECTIONS, Collection
from .config import Principal
from .db import WriteContext, get_conn, read_tx, writer
from .models import ModulePatch, PlantCreate, PlantPatch, Reorder, ZoneCreate, build_models

router = APIRouter(prefix=repo.API_PREFIX)

Viewer = Depends(require("viewer"))
STAGES = {"1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "total": None}


def _changes(body) -> dict:
    try:
        return body.changes()
    except ValueError as e:
        raise HTTPException(422, str(e))


# ============================================================== meta
@router.get("/me", tags=["meta"])
def me(principal: Principal = Depends(current_principal)):
    return {"name": principal.name, "role": principal.role}


@router.get("/zones", tags=["zones"], dependencies=[Viewer])
def list_zones(conn: psycopg.Connection = Depends(get_conn)):
    return {"items": conn.execute(
        """SELECT z.id, z.name, count(p.id) AS plant_count, z.created_at, z.updated_at
           FROM zones z LEFT JOIN plants p ON p.zone_id = z.id GROUP BY z.id ORDER BY z.name""").fetchall()}


@router.post("/zones", tags=["zones"], status_code=201)
def create_zone(body: ZoneCreate, ctx: WriteContext = Depends(writer("admin"))):
    with ctx.tx() as conn:
        return conn.execute("INSERT INTO zones (name) VALUES (%s) RETURNING *", (body.name,)).fetchone()


# ============================================================== plants
@router.get("/plants", tags=["plants"], dependencies=[Viewer])
def list_plants(
    conn: psycopg.Connection = Depends(get_conn),
    q: Optional[str] = Query(None, max_length=200, description="Matches name, display name or serial number"),
    zone_id: Optional[int] = None,
    zone: Optional[str] = Query(None, max_length=200, description="Zone name (case-insensitive)"),
    serial_number: Optional[str] = Query(None, max_length=200),
    legacy_plant_id: Optional[int] = None,
    origin: Optional[Literal["legacy", "app"]] = None,
    modified: Optional[bool] = Query(None, description="Only plants with (true) / without (false) edits"),
    equipment: Optional[str] = Query(None, max_length=200,
                                     description="Matches equipment code / name / make / model"),
    sort: str = "legacy_plant_id",
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    with read_tx(conn):
        return repo.search_plants(conn, q=q, zone_id=zone_id, zone=zone, serial_number=serial_number,
                                  legacy_plant_id=legacy_plant_id, origin=origin, modified=modified,
                                  equipment=equipment, sort=sort, limit=limit, offset=offset)


@router.get("/plants/by-legacy-id/{legacy_plant_id}", tags=["plants"], dependencies=[Viewer])
def get_plant_by_legacy_id(legacy_plant_id: int, conn: psycopg.Connection = Depends(get_conn)):
    with read_tx(conn):
        row = conn.execute("SELECT id FROM plants WHERE legacy_plant_id = %s", (legacy_plant_id,)).fetchone()
        if row is None:
            raise repo.NotFound(f"Plant with legacy id {legacy_plant_id}")
        return repo.plant_document(conn, row["id"])


@router.get("/plants/{plant_id}", tags=["plants"], dependencies=[Viewer])
def get_plant(plant_id: int, conn: psycopg.Connection = Depends(get_conn)):
    with read_tx(conn):
        return repo.plant_document(conn, plant_id)


@router.post("/plants", tags=["plants"], status_code=201)
def create_plant(body: PlantCreate, ctx: WriteContext = Depends(writer("admin"))):
    with ctx.tx() as conn:
        repo.ensure_zone(conn, body.zone_id)
        pid = conn.execute(
            """INSERT INTO plants (name, display_name, serial_number, capacity, site_contact_number, zone_id)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
            (body.name, body.display_name, body.serial_number, body.capacity, body.site_contact_number,
             body.zone_id)).fetchone()["id"]
        conn.cursor().executemany(
            "INSERT INTO plant_modules (plant_id, position, stage, is_total) VALUES (%s, %s, %s, %s)",
            [(pid, i, i, False) for i in range(1, 6)] + [(pid, 6, None, True)])
        return repo.plant_document(conn, pid)


@router.patch("/plants/{plant_id}", tags=["plants"])
def update_plant(plant_id: int, body: PlantPatch, ctx: WriteContext = Depends(writer())):
    changes = _changes(body)
    with ctx.tx() as conn:
        row = repo.fetch_plant_row(conn, plant_id, lock=True)
        repo.check_expected(row, body.expected_updated_at)
        if "zone_id" in changes:
            repo.ensure_zone(conn, changes["zone_id"])
        repo.update_row(conn, "plants", plant_id, changes)
        return repo.serialize_plant_core(repo.fetch_plant_row(conn, plant_id))


@router.delete("/plants/{plant_id}", tags=["plants"], status_code=204)
def delete_plant(plant_id: int, ctx: WriteContext = Depends(writer("admin"))):
    with ctx.tx() as conn:
        row = repo.fetch_plant_row(conn, plant_id, lock=True)
        if row["legacy_plant_id"] is not None:
            raise HTTPException(409, "Plants imported from the legacy system cannot be deleted")
        conn.execute("DELETE FROM plants WHERE id = %s", (plant_id,))
    return Response(status_code=204)


@router.get("/plants/{plant_id}/legacy", tags=["provenance"], dependencies=[Viewer])
def get_legacy_snapshot(plant_id: int, conn: psycopg.Connection = Depends(get_conn)):
    with read_tx(conn):
        return repo.legacy_snapshot(conn, plant_id)


@router.get("/plants/{plant_id}/history", tags=["provenance"], dependencies=[Viewer])
def get_history(plant_id: int, conn: psycopg.Connection = Depends(get_conn),
                request_id: Optional[str] = Query(None, max_length=100),
                limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0)):
    with read_tx(conn):
        return repo.history(conn, plant_id, limit, offset, request_id)


# ============================================================== modules
@router.get("/plants/{plant_id}/modules", tags=["modules"], dependencies=[Viewer])
def list_modules(plant_id: int, conn: psycopg.Connection = Depends(get_conn)):
    with read_tx(conn):
        repo.fetch_plant_row(conn, plant_id)
        return {"items": [repo.serialize_module(r) for r in conn.execute(
            "SELECT * FROM plant_modules WHERE plant_id = %s ORDER BY position", (plant_id,))]}


@router.patch("/plants/{plant_id}/modules/{stage}", tags=["modules"])
def update_module(plant_id: int, stage: Literal["1", "2", "3", "4", "5", "total"], body: ModulePatch,
                  ctx: WriteContext = Depends(writer())):
    changes = _changes(body)
    # Editing the text re-derives quantity/type with the import rule unless they are given explicitly.
    if "value_text" in changes and not {"quantity", "module_type"} & changes.keys():
        changes["quantity"], changes["module_type"] = repo.parse_module(changes["value_text"])
    with ctx.tx() as conn:
        repo.fetch_plant_row(conn, plant_id, lock=True)
        cond = "is_total" if STAGES[stage] is None else "stage = %s"
        args = (plant_id,) if STAGES[stage] is None else (plant_id, STAGES[stage])
        row = conn.execute(f"SELECT * FROM plant_modules WHERE plant_id = %s AND {cond} FOR UPDATE", args).fetchone()
        if row is None:
            raise repo.NotFound(f"Module stage {stage}")
        repo.check_expected(row, body.expected_updated_at)
        repo.update_row(conn, "plant_modules", row["id"], changes)
        return repo.serialize_module(conn.execute("SELECT * FROM plant_modules WHERE id = %s", (row["id"],)).fetchone())


# ============================================================== ordered collections
def _register(coll: Collection, prefix: str, nested_under: Collection | None = None):
    """CRUD + reorder routes for one collection. For nested collections the URL carries the
    parent id: /plants/{plant_id}/<parent slug>/{parent_id}/<slug>."""
    Create, Patch = build_models(coll)
    tag = (nested_under or coll).slug
    nested = nested_under is not None

    if nested:
        def list_(plant_id: int, parent_id: int, conn: psycopg.Connection = Depends(get_conn)):
            with read_tx(conn):
                repo.ensure_parent(conn, coll, plant_id, parent_id)
                return {"items": repo.list_items(conn, coll, parent_id)}

        def get_(plant_id: int, parent_id: int, item_id: int, conn: psycopg.Connection = Depends(get_conn)):
            with read_tx(conn):
                repo.ensure_parent(conn, coll, plant_id, parent_id)
                return repo.get_item(conn, coll, parent_id, item_id)
    else:
        def list_(plant_id: int, conn: psycopg.Connection = Depends(get_conn)):
            with read_tx(conn):
                repo.ensure_parent(conn, coll, plant_id, plant_id)
                sec = conn.execute("SELECT rendered_in_legacy, legacy_count FROM plant_sections "
                                   "WHERE plant_id = %s AND section = %s", (plant_id, coll.section)).fetchone()
                return {"legacy": None if sec is None else {"rendered": sec["rendered_in_legacy"],
                                                            "count": sec["legacy_count"]},
                        "items": repo.list_items(conn, coll, plant_id)}

        def get_(plant_id: int, item_id: int, conn: psycopg.Connection = Depends(get_conn)):
            with read_tx(conn):
                repo.ensure_parent(conn, coll, plant_id, plant_id)
                return repo.get_item(conn, coll, plant_id, item_id)

    # ---- core operations (pid = id of the direct parent row)
    def do_create(plant_id: int, pid: int, body, ctx: WriteContext):
        values = {f: getattr(body, f) for f in coll.field_names}
        children = getattr(body, coll.child_key) if coll.child is not None else None
        if all(v is None for v in values.values()) and not children:
            raise HTTPException(422, "at least one field must be non-null")
        with ctx.tx() as conn:
            repo.ensure_parent(conn, coll, plant_id, pid, lock=True)
            new_id = repo.insert_item(conn, coll, pid, values, body.position)
            for child in children or []:
                cvals = child.model_dump()
                if all(v is None for v in cvals.values()):
                    raise HTTPException(422, f"{coll.child_key}: at least one field must be non-null")
                repo.insert_item(conn, coll.child, new_id, cvals, None)
            return repo.get_item(conn, coll, pid, new_id)

    def do_update(plant_id: int, pid: int, item_id: int, body, ctx: WriteContext):
        changes = _changes(body)
        with ctx.tx() as conn:
            repo.ensure_parent(conn, coll, plant_id, pid)
            row = repo.fetch_item_row(conn, coll, pid, item_id, lock=True)
            repo.check_expected(row, body.expected_updated_at)
            repo.update_row(conn, coll.table, item_id, changes)
            return repo.get_item(conn, coll, pid, item_id)

    def do_delete(plant_id: int, pid: int, item_id: int, ctx: WriteContext):
        with ctx.tx() as conn:
            repo.ensure_parent(conn, coll, plant_id, pid, lock=True)
            repo.delete_item(conn, coll, pid, item_id)
        return Response(status_code=204)

    def do_reorder(plant_id: int, pid: int, body: Reorder, ctx: WriteContext):
        with ctx.tx() as conn:
            repo.ensure_parent(conn, coll, plant_id, pid, lock=True)
            repo.reorder(conn, coll, pid, body.ids)
            return {"items": repo.list_items(conn, coll, pid)}

    # ---- thin wrappers with the right path parameters
    if nested:
        def create_(plant_id: int, parent_id: int, body: Create, ctx: WriteContext = Depends(writer())):  # type: ignore[valid-type]
            return do_create(plant_id, parent_id, body, ctx)

        def update_(plant_id: int, parent_id: int, item_id: int, body: Patch,  # type: ignore[valid-type]
                    ctx: WriteContext = Depends(writer())):
            return do_update(plant_id, parent_id, item_id, body, ctx)

        def delete_(plant_id: int, parent_id: int, item_id: int, ctx: WriteContext = Depends(writer())):
            return do_delete(plant_id, parent_id, item_id, ctx)

        def reorder_(plant_id: int, parent_id: int, body: Reorder, ctx: WriteContext = Depends(writer())):
            return do_reorder(plant_id, parent_id, body, ctx)
    else:
        def create_(plant_id: int, body: Create, ctx: WriteContext = Depends(writer())):  # type: ignore[valid-type]
            return do_create(plant_id, plant_id, body, ctx)

        def update_(plant_id: int, item_id: int, body: Patch,  # type: ignore[valid-type]
                    ctx: WriteContext = Depends(writer())):
            return do_update(plant_id, plant_id, item_id, body, ctx)

        def delete_(plant_id: int, item_id: int, ctx: WriteContext = Depends(writer())):
            return do_delete(plant_id, plant_id, item_id, ctx)

        def reorder_(plant_id: int, body: Reorder, ctx: WriteContext = Depends(writer())):
            return do_reorder(plant_id, plant_id, body, ctx)

    base = f"{prefix}/{coll.slug}"
    item = base + "/{item_id}"
    name = coll.table
    viewer = [Viewer]
    router.add_api_route(base, list_, methods=["GET"], tags=[tag], dependencies=viewer, name=f"list_{name}")
    router.add_api_route(base, create_, methods=["POST"], tags=[tag], status_code=201, name=f"create_{name}")
    router.add_api_route(base + "/order", reorder_, methods=["PUT"], tags=[tag], name=f"reorder_{name}")
    router.add_api_route(item, get_, methods=["GET"], tags=[tag], dependencies=viewer, name=f"get_{name}")
    router.add_api_route(item, update_, methods=["PATCH"], tags=[tag], name=f"update_{name}")
    router.add_api_route(item, delete_, methods=["DELETE"], tags=[tag], status_code=204, name=f"delete_{name}")


for _c in PLANT_COLLECTIONS:
    _register(_c, "/plants/{plant_id}")
    if _c.child is not None:
        _register(_c.child, "/plants/{plant_id}/" + _c.slug + "/{parent_id}", nested_under=_c)
