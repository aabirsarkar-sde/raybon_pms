"""Plant document library: upload, download, revise, delete — on both storage backends."""
import hashlib

import pytest
from fastapi.testclient import TestClient

from conftest import TOKENS, auth
from pdm_api.config import Settings, hash_token, load_tokens
from pdm_api.main import create_app

P = "/api/v1"
PDF = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"


@pytest.fixture
def plant_id(client):
    return client.get(f"{P}/plants", params={"limit": 1}, headers=auth("viewer")).json()["items"][0]["id"]


def upload(client, plant_id, *, role="editor", reason=None, name="skid.pdf", content=PDF,
           category="pid", title="Main skid P&ID", description=None, replace=None):
    data = {"category": category, "title": title}
    if description is not None:
        data["description"] = description
    if replace is not None:
        data["replace"] = str(replace).lower()
    return client.post(f"{P}/plants/{plant_id}/documents", headers=auth(role, reason),
                       files={"file": (name, content, "application/octet-stream")}, data=data)


def fs_client(api_dsn, root):
    settings = Settings(
        database_url=api_dsn,
        tokens=load_tokens([{"name": f"{r}-user", "role": r, "token_sha256": hash_token(t)}
                            for r, t in TOKENS.items()]),
        pool_min_size=1, pool_max_size=4,
        document_storage="fs", document_root=root,
    )
    return TestClient(create_app(settings))


# ============================================================ access control
def test_roles(client, plant_id):
    assert client.get(f"{P}/plants/{plant_id}/documents").status_code == 401
    assert client.get(f"{P}/plants/{plant_id}/documents", headers=auth("viewer")).status_code == 200
    assert upload(client, plant_id, role="viewer").status_code == 403       # uploading is editing
    doc = upload(client, plant_id).json()
    assert client.get(f"{P}/plants/{plant_id}/documents/{doc['id']}/content",
                      headers=auth("viewer")).status_code == 200            # viewers may read
    assert client.delete(f"{P}/plants/{plant_id}/documents/{doc['id']}",
                         headers=auth("viewer")).status_code == 403


def test_categories_describe_the_upload_form(client):
    r = client.get(f"{P}/document-categories", headers=auth("viewer")).json()
    assert [i["key"] for i in r["items"]][:4] == ["pid", "electrical", "mechanical", "layout"]
    assert dict((i["key"], i["label"]) for i in r["items"])["pid"] == "P&ID"
    assert "pdf" in r["allowed_extensions"] and "html" not in r["allowed_extensions"]
    assert r["max_bytes"] == 25 * 1024 * 1024 and r["storage"] == "db"


# ============================================================ upload
def test_upload_and_list(client, plant_id):
    r = upload(client, plant_id, reason="issued for construction",
               description="Revision A", name="RO Skid P&ID.pdf")
    assert r.status_code == 201, r.text
    doc = r.json()
    assert doc["category"] == "pid" and doc["category_label"] == "P&ID"
    assert doc["file_name"] == "RO Skid P&ID.pdf" and doc["extension"] == "pdf"
    assert doc["content_type"] == "application/pdf" and doc["can_preview"] is True
    assert doc["byte_size"] == len(PDF)
    assert doc["sha256"] == hashlib.sha256(PDF).hexdigest()
    assert doc["description"] == "Revision A"
    assert doc["uploaded_by"] == "editor-user"
    assert doc["download_href"] == f"{P}/plants/{plant_id}/documents/{doc['id']}/content"

    listing = client.get(f"{P}/plants/{plant_id}/documents", headers=auth("viewer")).json()
    assert listing["total"] == 1 and listing["counts"] == {"pid": 1}
    assert listing["total_bytes"] == len(PDF)
    assert listing["items"][0] == doc


def test_upload_is_audited_with_the_change_reason(client, plant_id):
    upload(client, plant_id, reason="P&ID revision A")
    history = client.get(f"{P}/plants/{plant_id}/history", headers=auth("viewer")).json()["items"]
    entry = next(h for h in history if h["table_name"] == "plant_documents")
    assert entry["operation"] == "INSERT"
    assert entry["changed_by"] == "editor-user" and entry["reason"] == "P&ID revision A"
    assert entry["new_row"]["title"] == "Main skid P&ID"


def test_documents_are_counted_on_the_plant(client, plant_id):
    assert client.get(f"{P}/plants/{plant_id}", headers=auth("viewer")).json()["documents"] == 0
    upload(client, plant_id)
    plant = client.get(f"{P}/plants/{plant_id}", headers=auth("viewer")).json()
    assert plant["documents"] == 1
    assert plant["links"]["documents"] == f"{P}/plants/{plant_id}/documents"
    listed = client.get(f"{P}/plants", params={"limit": 500}, headers=auth("viewer")).json()
    assert next(p for p in listed["items"] if p["id"] == plant_id)["documents"] == 1


def test_each_category_holds_its_own_documents(client, plant_id):
    for category in ("pid", "electrical", "layout", "manual"):
        assert upload(client, plant_id, category=category, title=category.title()).status_code == 201
    listing = client.get(f"{P}/plants/{plant_id}/documents", headers=auth("viewer")).json()
    assert listing["total"] == 4
    assert listing["counts"] == {"pid": 1, "electrical": 1, "layout": 1, "manual": 1}
    only = client.get(f"{P}/plants/{plant_id}/documents", params={"category": "layout"},
                      headers=auth("viewer")).json()
    assert only["total"] == 1 and only["items"][0]["category"] == "layout"
    assert only["counts"] == listing["counts"]          # the library's shape stays visible


def test_search_within_a_plants_library(client, plant_id):
    upload(client, plant_id, name="a.pdf", title="Feed pump datasheet", category="datasheet")
    upload(client, plant_id, name="b.pdf", title="HT panel drawing", category="electrical",
           description="Feeder schedule")
    find = lambda q: client.get(f"{P}/plants/{plant_id}/documents", params={"q": q},  # noqa: E731
                                headers=auth("viewer")).json()
    assert find("pump")["total"] == 1
    assert find("feed")["total"] == 2                   # title and description
    assert find("b.pdf")["total"] == 1                  # file name
    assert find("100%_")["total"] == 0                  # wildcards escaped


# ============================================================ validation
@pytest.mark.parametrize("name", ["evil.html", "evil.svg", "run.sh", "x.exe", "noextension"])
def test_rejects_file_types_that_could_carry_script(client, plant_id, name):
    r = upload(client, plant_id, name=name, content=b"<script>alert(1)</script>")
    assert r.status_code == 422
    assert "not accepted" in r.text or "needs an extension" in r.text


def test_content_type_comes_from_the_extension_not_the_uploader(client, plant_id):
    """A browser's Content-Type is attacker-controlled; the extension decides."""
    r = client.post(f"{P}/plants/{plant_id}/documents", headers=auth("editor"),
                    files={"file": ("photo.png", b"\x89PNG\r\n\x1a\n", "text/html")},
                    data={"category": "photo", "title": "Site photo"})
    assert r.status_code == 201 and r.json()["content_type"] == "image/png"


def test_path_traversal_in_the_file_name_is_defused(client, plant_id):
    r = upload(client, plant_id, name="../../../etc/passwd.pdf")
    assert r.status_code == 201
    assert r.json()["file_name"] == "passwd.pdf"


def test_rejects_empty_file_bad_category_and_bad_title(client, plant_id):
    assert upload(client, plant_id, content=b"").status_code == 422
    assert upload(client, plant_id, category="blueprints").status_code == 422
    assert upload(client, plant_id, title="   ").status_code == 422
    assert upload(client, plant_id, title="x" * 301).status_code == 422


def test_rejects_a_file_over_the_size_limit(api_dsn):
    settings = Settings(
        database_url=api_dsn,
        tokens=load_tokens([{"name": "editor-user", "role": "editor",
                             "token_sha256": hash_token(TOKENS["editor"])}]),
        pool_min_size=1, pool_max_size=2, document_max_mb=1,
    )
    with TestClient(create_app(settings)) as c:
        pid = c.get(f"{P}/plants", params={"limit": 1}, headers=auth("editor")).json()["items"][0]["id"]
        r = c.post(f"{P}/plants/{pid}/documents", headers=auth("editor"),
                   files={"file": ("big.pdf", b"x" * (1024 * 1024 + 1), "application/pdf")},
                   data={"category": "pid", "title": "Too big"})
        assert r.status_code == 413 and "1 MB" in r.text


def test_unknown_plant_and_unknown_document(client, plant_id):
    assert upload(client, 999999).status_code == 404
    assert client.get(f"{P}/plants/{plant_id}/documents/999999", headers=auth("viewer")).status_code == 404
    other = client.get(f"{P}/plants", params={"limit": 2}, headers=auth("viewer")).json()["items"][1]["id"]
    doc = upload(client, plant_id).json()
    # A document is reachable only through its own plant.
    assert client.get(f"{P}/plants/{other}/documents/{doc['id']}", headers=auth("viewer")).status_code == 404


# ============================================================ download
def test_download_is_always_an_attachment_unless_safe_to_inline(client, plant_id):
    doc = upload(client, plant_id, name="plan.pdf").json()
    url = f"{P}/plants/{plant_id}/documents/{doc['id']}/content"
    r = client.get(url, headers=auth("viewer"))
    assert r.status_code == 200 and r.content == PDF
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith('attachment; filename="plan.pdf"')
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["etag"] == f'"{doc["sha256"]}"'

    inline = client.get(url, params={"inline": "true"}, headers=auth("viewer"))
    assert inline.headers["content-disposition"].startswith("inline")

    # A zip can be asked for inline, but is still sent as a download.
    zipped = upload(client, plant_id, name="pack.zip", content=b"PK\x03\x04", category="other").json()
    r = client.get(f"{P}/plants/{plant_id}/documents/{zipped['id']}/content",
                   params={"inline": "true"}, headers=auth("viewer"))
    assert r.headers["content-disposition"].startswith("attachment")
    assert zipped["can_preview"] is False


def test_non_ascii_file_name_survives_the_round_trip(client, plant_id):
    doc = upload(client, plant_id, name="Anlagenplan Übersicht.pdf").json()
    assert doc["file_name"] == "Anlagenplan Übersicht.pdf"
    r = client.get(f"{P}/plants/{plant_id}/documents/{doc['id']}/content", headers=auth("viewer"))
    assert "filename*=UTF-8''Anlagenplan%20%C3%9Cbersicht.pdf" in r.headers["content-disposition"]


# ============================================================ revise / edit / delete
def test_reupload_needs_replace_and_then_keeps_the_same_document(client, plant_id):
    first = upload(client, plant_id, name="skid.pdf", description="Revision A").json()
    clash = upload(client, plant_id, name="skid.pdf")
    assert clash.status_code == 409 and "replace=true" in clash.text

    revised = upload(client, plant_id, name="skid.pdf", content=PDF + b"rev B",
                     description="Revision B", replace=True, reason="revision B")
    assert revised.status_code == 201
    doc = revised.json()
    assert doc["id"] == first["id"]                      # same document, new revision
    assert doc["byte_size"] == len(PDF) + 5
    assert doc["sha256"] == hashlib.sha256(PDF + b"rev B").hexdigest()
    assert doc["description"] == "Revision B"
    assert client.get(f"{P}/plants/{plant_id}/documents", headers=auth("viewer")).json()["total"] == 1
    assert client.get(f"{P}/plants/{plant_id}/documents/{doc['id']}/content",
                      headers=auth("viewer")).content == PDF + b"rev B"
    history = client.get(f"{P}/plants/{plant_id}/history", headers=auth("viewer")).json()["items"]
    assert any(h["column_name"] == "sha256" and h["reason"] == "revision B" for h in history)


def test_the_same_file_name_may_exist_in_another_category(client, plant_id):
    assert upload(client, plant_id, name="drawing.pdf", category="pid").status_code == 201
    assert upload(client, plant_id, name="drawing.pdf", category="electrical").status_code == 201
    assert client.get(f"{P}/plants/{plant_id}/documents", headers=auth("viewer")).json()["total"] == 2


def test_refiling_and_renaming_a_document(client, plant_id):
    doc = upload(client, plant_id, category="other", title="Scan 001").json()
    r = client.patch(f"{P}/plants/{plant_id}/documents/{doc['id']}",
                     json={"category": "pid", "title": "RO skid P&ID", "description": "As-built",
                           "expected_updated_at": doc["updated_at"]},
                     headers=auth("editor", "filed correctly"))
    assert r.status_code == 200, r.text
    assert (r.json()["category"], r.json()["title"]) == ("pid", "RO skid P&ID")
    assert r.json()["file_name"] == doc["file_name"]      # the file itself is untouched

    stale = client.patch(f"{P}/plants/{plant_id}/documents/{doc['id']}",
                         json={"title": "Again", "expected_updated_at": doc["updated_at"]},
                         headers=auth("editor"))
    assert stale.status_code == 409                       # someone else changed it first
    assert client.patch(f"{P}/plants/{plant_id}/documents/{doc['id']}", json={"title": None},
                        headers=auth("editor")).status_code == 422
    assert client.patch(f"{P}/plants/{plant_id}/documents/{doc['id']}", json={},
                        headers=auth("editor")).status_code == 422


def test_delete_removes_the_metadata_and_the_file(client, plant_id, admin_conn):
    doc = upload(client, plant_id).json()
    r = client.delete(f"{P}/plants/{plant_id}/documents/{doc['id']}", headers=auth("editor", "superseded"))
    assert r.status_code == 204
    assert client.get(f"{P}/plants/{plant_id}/documents", headers=auth("viewer")).json()["total"] == 0
    assert admin_conn.execute("SELECT count(*) FROM plant_document_blobs").fetchone()[0] == 0
    history = client.get(f"{P}/plants/{plant_id}/history", headers=auth("viewer")).json()["items"]
    assert any(h["table_name"] == "plant_documents" and h["operation"] == "DELETE"
               and h["reason"] == "superseded" for h in history)


def test_deleting_a_plant_deletes_its_documents(client, admin_conn):
    created = client.post(f"{P}/plants", json={"name": "doc test plant"}, headers=auth("admin")).json()
    assert upload(client, created["id"], role="admin").status_code == 201
    assert client.delete(f"{P}/plants/{created['id']}", headers=auth("admin")).status_code == 204
    assert admin_conn.execute("SELECT count(*) FROM plant_documents").fetchone()[0] == 0
    assert admin_conn.execute("SELECT count(*) FROM plant_document_blobs").fetchone()[0] == 0


def test_the_audit_log_never_holds_the_file_itself(client, plant_id, admin_conn):
    upload(client, plant_id, content=b"%PDF-1.4 SECRET-MARKER-IN-FILE-BYTES\n%%EOF")
    rows = admin_conn.execute("SELECT count(*) FROM change_log WHERE new_row::text LIKE %s",
                              ("%SECRET-MARKER%",)).fetchone()[0]
    assert rows == 0


# ============================================================ filesystem backend
def test_filesystem_backend_stores_reads_and_cleans_up(api_dsn, tmp_path, admin_conn):
    root = tmp_path / "library"
    with fs_client(api_dsn, root) as c:
        pid = c.get(f"{P}/plants", params={"limit": 1}, headers=auth("viewer")).json()["items"][0]["id"]
        doc = upload(c, pid, name="layout.pdf", category="layout", title="Layout").json()
        assert doc["byte_size"] == len(PDF)

        stored = list(root.rglob("*.pdf"))
        assert len(stored) == 1 and stored[0].read_bytes() == PDF
        assert stored[0].parent == root / "plants" / str(pid)        # never the uploaded name
        key = admin_conn.execute("SELECT storage, storage_key FROM plant_documents").fetchone()
        assert key[0] == "fs" and key[1] == f"plants/{pid}/{stored[0].name}"
        assert admin_conn.execute("SELECT count(*) FROM plant_document_blobs").fetchone()[0] == 0

        r = c.get(f"{P}/plants/{pid}/documents/{doc['id']}/content", headers=auth("viewer"))
        assert r.status_code == 200 and r.content == PDF

        # A revision writes a new file and drops the old one.
        revised = upload(c, pid, name="layout.pdf", category="layout", title="Layout",
                         content=PDF + b"B", replace=True).json()
        assert revised["id"] == doc["id"]
        files = list(root.rglob("*.pdf"))
        assert len(files) == 1 and files[0].read_bytes() == PDF + b"B"

        assert c.delete(f"{P}/plants/{pid}/documents/{doc['id']}", headers=auth("editor")).status_code == 204
        assert list(root.rglob("*.pdf")) == []


def test_filesystem_backend_reports_a_file_that_disappeared(api_dsn, tmp_path):
    with fs_client(api_dsn, tmp_path) as c:
        pid = c.get(f"{P}/plants", params={"limit": 1}, headers=auth("viewer")).json()["items"][0]["id"]
        doc = upload(c, pid).json()
        for f in tmp_path.rglob("*.pdf"):
            f.unlink()
        r = c.get(f"{P}/plants/{pid}/documents/{doc['id']}/content", headers=auth("viewer"))
        assert r.status_code == 410
        # The metadata is still listed, so the gap is visible rather than silent.
        assert c.get(f"{P}/plants/{pid}/documents", headers=auth("viewer")).json()["total"] == 1


def test_filesystem_backend_needs_a_root(api_dsn):
    settings = Settings(database_url=api_dsn, tokens={}, document_storage="fs", document_root=None)
    with pytest.raises(RuntimeError, match="PDM_DOCUMENT_ROOT"):
        create_app(settings)
    bad = Settings(database_url=api_dsn, tokens={}, document_storage="s3")
    with pytest.raises(RuntimeError, match="must be 'db' or 'fs'"):
        create_app(bad)
