"""Plant document library: upload, list, download, re-upload and delete."""
from typing import Optional

import psycopg
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse

from . import repository as repo
from .auth import require
from .db import WriteContext, get_conn, read_tx, writer
from .documents import (ALLOWED, CATEGORIES, INLINE_OK, Storage, category_problem, check_upload_name,
                        content_disposition, payload)
from .models import PatchBase, Text
from .repository import API_PREFIX, like_pattern

router = APIRouter(prefix=API_PREFIX)

Viewer = Depends(require("viewer"))
MAX_TITLE = 300
MAX_DESCRIPTION = 2000


def get_storage(request: Request) -> Storage:
    return request.app.state.documents


class DocumentPatch(PatchBase):
    """How a document is filed and described. The file itself is changed by
    uploading it again with replace=true, which keeps the document's id."""
    category: Text = None  # type: ignore[assignment]
    title: Text = None  # type: ignore[assignment]
    description: Optional[Text] = None


def _fetch(conn, plant_id: int, document_id: int, lock: bool = False) -> dict:
    row = conn.execute("SELECT * FROM plant_documents WHERE id = %s AND plant_id = %s"
                       + (" FOR UPDATE" if lock else ""), (document_id, plant_id)).fetchone()
    if row is None:
        raise repo.NotFound(f"Document {document_id} of plant {plant_id}")
    return row


def _check_category(category: str) -> str:
    problem = category_problem(category)
    if problem:
        raise HTTPException(422, problem)
    return category


def _check_title(title: str) -> str:
    title = (title or "").strip()
    if not 1 <= len(title) <= MAX_TITLE:
        raise HTTPException(422, f"title must be 1–{MAX_TITLE} characters")
    return title


def _check_description(description: str | None) -> str | None:
    description = (description or "").strip() or None
    if description is not None and len(description) > MAX_DESCRIPTION:
        raise HTTPException(422, f"description must be at most {MAX_DESCRIPTION} characters")
    return description


@router.get("/document-categories", tags=["documents"], dependencies=[Viewer])
def list_categories(request: Request):
    """Everything the upload form needs: the filing categories, what files are
    accepted and how large they may be."""
    s = request.app.state.settings
    return {
        "items": [{"key": k, "label": label} for k, label in CATEGORIES],
        "allowed_extensions": sorted(ALLOWED),
        "max_bytes": s.document_max_mb * 1024 * 1024,
        "storage": s.document_storage,
    }


@router.get("/plants/{plant_id}/documents", tags=["documents"], dependencies=[Viewer])
def list_documents(plant_id: int, conn: psycopg.Connection = Depends(get_conn),
                   category: Optional[str] = Query(None, max_length=50),
                   q: Optional[str] = Query(None, max_length=200,
                                            description="Matches title, description or file name")):
    if category is not None:
        _check_category(category)
    with read_tx(conn):
        repo.fetch_plant_row(conn, plant_id)
        where: list[str] = ["plant_id = %s"]
        args: list = [plant_id]
        if category:
            where.append("category = %s")
            args.append(category)
        if q:
            where.append("(title ILIKE %s OR description ILIKE %s OR file_name ILIKE %s)")
            args += [like_pattern(q)] * 3
        rows = conn.execute(f"""SELECT * FROM plant_documents WHERE {' AND '.join(where)}
                                ORDER BY created_at DESC, id DESC""", args).fetchall()
        # Counts cover the whole library, so a category filter still shows what else is there.
        counts = conn.execute("""SELECT category, count(*) AS n, sum(byte_size) AS bytes
                                 FROM plant_documents WHERE plant_id = %s GROUP BY category""",
                              (plant_id,)).fetchall()
        return {
            "items": [payload(r) for r in rows],
            "total": len(rows),
            "counts": {c["category"]: c["n"] for c in counts},
            "total_bytes": sum(int(c["bytes"]) for c in counts),
        }


@router.get("/plants/{plant_id}/documents/{document_id}", tags=["documents"], dependencies=[Viewer])
def get_document(plant_id: int, document_id: int, conn: psycopg.Connection = Depends(get_conn)):
    with read_tx(conn):
        return payload(_fetch(conn, plant_id, document_id))


@router.get("/plants/{plant_id}/documents/{document_id}/content", tags=["documents"],
            dependencies=[Viewer], response_class=Response)
def download_document(plant_id: int, document_id: int,
                      inline: bool = Query(False, description="Show in the browser instead of "
                                                              "downloading, where the format allows it"),
                      conn: psycopg.Connection = Depends(get_conn),
                      storage: Storage = Depends(get_storage)):
    """The file itself: always nosniff, and inline only for formats that cannot
    carry script, so an uploaded file never runs in the application's origin."""
    doc = _fetch(conn, plant_id, document_id)
    headers = {
        "Content-Disposition": content_disposition(doc["file_name"],
                                                   inline and doc["content_type"] in INLINE_OK),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=0, must-revalidate",
        "ETag": f'"{doc["sha256"]}"',
    }
    if doc["storage"] == "fs":
        return FileResponse(storage.fs_path(doc), media_type=doc["content_type"], headers=headers)
    return Response(storage.db_bytes(conn, doc), media_type=doc["content_type"], headers=headers)


@router.post("/plants/{plant_id}/documents", tags=["documents"], status_code=201)
def upload_document(
    plant_id: int,
    file: UploadFile = File(..., description="The document itself"),
    category: str = Form(..., description="One of GET /document-categories"),
    title: str = Form(..., description="What this document is, as people should see it"),
    description: Optional[str] = Form(None),
    replace: bool = Form(False, description="Overwrite the existing document with the same category "
                                            "and file name, keeping its id, links and history"),
    ctx: WriteContext = Depends(writer()),
    storage: Storage = Depends(get_storage),
):
    category = _check_category(category)
    title = _check_title(title)
    description = _check_description(description)
    file_name, content_type = check_upload_name(file.filename or "")
    data, sha256, size = storage.read_upload(file)
    key = storage.new_key(plant_id, file_name.rsplit(".", 1)[-1].lower())
    superseded: dict | None = None
    try:
        with ctx.tx() as conn:
            repo.fetch_plant_row(conn, plant_id, lock=True)
            existing = conn.execute("""SELECT * FROM plant_documents
                                       WHERE plant_id = %s AND category = %s AND lower(file_name) = lower(%s)
                                       FOR UPDATE""", (plant_id, category, file_name)).fetchone()
            if existing is not None and not replace:
                raise HTTPException(409, f"'{file_name}' is already in this plant's "
                                         f"{category} documents. Send replace=true to update it.")
            if existing is None:
                row = conn.execute(
                    """INSERT INTO plant_documents (plant_id, category, title, description, file_name,
                           content_type, byte_size, sha256, storage, storage_key, uploaded_by)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                    (plant_id, category, title, description, file_name, content_type, size, sha256,
                     storage.backend, key, ctx.principal.name)).fetchone()
                storage.put(conn, row["id"], key, data, sha256, size)
            else:
                row = conn.execute(
                    """UPDATE plant_documents SET title = %s, description = %s, content_type = %s,
                           byte_size = %s, sha256 = %s, storage = %s, storage_key = %s, uploaded_by = %s
                       WHERE id = %s RETURNING *""",
                    (title, description, content_type, size, sha256, storage.backend, key,
                     ctx.principal.name, existing["id"])).fetchone()
                storage.replace(conn, row["id"], key, data, sha256, size)
                if existing["storage"] == "fs" and existing["storage_key"] != key:
                    superseded = existing
    except Exception:
        # The transaction is rolled back, so no row points at `key` any more.
        storage.discard({"storage": storage.backend, "storage_key": key})
        raise
    if superseded is not None:
        storage.discard(superseded)
    return payload(row)


@router.patch("/plants/{plant_id}/documents/{document_id}", tags=["documents"])
def update_document(plant_id: int, document_id: int, body: DocumentPatch,
                    ctx: WriteContext = Depends(writer())):
    try:
        changes = body.changes()
    except ValueError as e:
        raise HTTPException(422, str(e))
    for k in ("category", "title"):
        if k in changes and changes[k] is None:
            raise HTTPException(422, f"{k} cannot be null")
    if "category" in changes:
        _check_category(changes["category"])
    if "title" in changes:
        changes["title"] = _check_title(changes["title"])
    if "description" in changes:
        changes["description"] = _check_description(changes["description"])
    with ctx.tx() as conn:
        row = _fetch(conn, plant_id, document_id, lock=True)
        repo.check_expected(row, body.expected_updated_at)
        repo.update_row(conn, "plant_documents", document_id, changes)
        return payload(_fetch(conn, plant_id, document_id))


@router.delete("/plants/{plant_id}/documents/{document_id}", tags=["documents"], status_code=204)
def delete_document(plant_id: int, document_id: int, ctx: WriteContext = Depends(writer()),
                    storage: Storage = Depends(get_storage)):
    with ctx.tx() as conn:
        doc = _fetch(conn, plant_id, document_id, lock=True)
        conn.execute("DELETE FROM plant_documents WHERE id = %s", (document_id,))
    # After the commit: a leftover file is harmless, a row without its file is not.
    storage.discard(doc)
    return Response(status_code=204)
