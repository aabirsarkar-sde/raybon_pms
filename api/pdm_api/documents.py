"""
Plant document library: P&IDs, electrical drawings, manuals, layouts and the
rest, each attached to one plant.

Metadata lives in plant_documents (and is audited in change_log like any other
plant data). The bytes live either

  * in PostgreSQL, in plant_document_blobs — the default. Nothing outside the
    database has to be deployed, persisted or backed up, which also means the
    files survive a redeploy of the API onto fresh storage; or
  * on the API server's disk, under PDM_DOCUMENT_ROOT — for libraries of large
    drawings, where keeping tens of gigabytes inside the database is not wanted.

Each document records which of the two holds it, so a library that outgrows the
database can be moved file by file without rewriting the old rows.

Uploads are deliberately strict: the extension decides the stored content type
(a browser's claim is never trusted), the extension must be one of ALLOWED, and
downloads are always sent as attachments with nosniff. Together those stop an
uploaded file from ever being executed as script in the application's origin.
"""
import hashlib
import re
import secrets
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException, UploadFile

CATEGORIES: tuple[tuple[str, str], ...] = (
    ("pid", "P&ID"),
    ("electrical", "Electrical drawing"),
    ("mechanical", "Mechanical drawing"),
    ("layout", "Plant layout"),
    ("manual", "Manual / O&M"),
    ("datasheet", "Datasheet"),
    ("report", "Report"),
    ("certificate", "Certificate"),
    ("photo", "Site photo"),
    ("other", "Other"),
)
CATEGORY_LABELS = dict(CATEGORIES)

# extension -> stored content type. The uploader's own Content-Type is ignored:
# it is attacker-controlled, and a mismatch is how "image.png" becomes script.
ALLOWED: dict[str, str] = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "tif": "image/tiff",
    "tiff": "image/tiff",
    "bmp": "image/bmp",
    "heic": "image/heic",
    "dwg": "image/vnd.dwg",
    "dxf": "image/vnd.dxf",
    "dwf": "model/vnd.dwf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain",
    "csv": "text/csv",
    "zip": "application/zip",
    "rar": "application/vnd.rar",
    "7z": "application/x-7z-compressed",
}
# Only these may be shown in the browser instead of downloaded. SVG is absent on
# purpose: it can carry script, and it would run in this application's origin.
INLINE_OK = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"}

CHUNK = 256 * 1024
# What a file name may not contain: control characters, path separators, and the
# characters that are reserved on Windows or would need quoting in a header.
# Letters of any script are kept — a drawing may legitimately be called
# "Anlagenplan Übersicht.pdf" — and the download header encodes them (RFC 5987).
_UNSAFE_NAME = re.compile(r'[\x00-\x1f\x7f<>:"/\\|?*]')
_STORAGE_KEY = re.compile(r"^plants/[0-9]+/[0-9a-f]{32}(\.[A-Za-z0-9]{1,16})?$")


def category_problem(category: str) -> str | None:
    if category not in CATEGORY_LABELS:
        return f"category must be one of {sorted(CATEGORY_LABELS)}"
    return None


def clean_file_name(name: str) -> str:
    """The name the file downloads under. Kept recognisable, but stripped of
    anything that could be read as a path or as a second extension."""
    name = unicodedata.normalize("NFKC", name or "").replace("\\", "/").split("/")[-1].strip()
    name = _UNSAFE_NAME.sub("_", name).strip(". ") or "document"
    return name[:300]


def extension_of(name: str) -> str:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return ext if ext.isalnum() else ""


def check_upload_name(file_name: str) -> tuple[str, str]:
    """(clean name, stored content type), or 422."""
    clean = clean_file_name(file_name)
    ext = extension_of(clean)
    if not ext:
        raise HTTPException(422, "The file needs an extension so its type can be recognised")
    if ext not in ALLOWED:
        raise HTTPException(422, f"'.{ext}' files are not accepted. Allowed: "
                                 + ", ".join("." + e for e in sorted(ALLOWED)))
    return clean, ALLOWED[ext]


def content_disposition(file_name: str, inline: bool) -> str:
    """RFC 6266 / 5987: an ASCII fallback plus the real, possibly non-ASCII, name."""
    ascii_name = file_name.encode("ascii", "replace").decode("ascii").replace('"', "_")
    return (f'{"inline" if inline else "attachment"}; filename="{ascii_name}"; '
            f"filename*=UTF-8''{quote(file_name, safe='')}")


# ------------------------------------------------------------------ storage
@dataclass(frozen=True)
class StoredFile:
    sha256: str
    byte_size: int
    storage: str
    storage_key: str


class Storage:
    """Where document bytes are kept. `key` is generated here and is the only
    thing the database records; it is re-validated on every read."""

    def __init__(self, backend: str, root: Path | None, max_bytes: int):
        if backend not in ("db", "fs"):
            raise RuntimeError("PDM_DOCUMENT_STORAGE must be 'db' or 'fs'")
        if backend == "fs" and root is None:
            raise RuntimeError("PDM_DOCUMENT_STORAGE=fs requires PDM_DOCUMENT_ROOT")
        self.backend = backend
        self.root = root
        self.max_bytes = max_bytes

    # -- keys
    def new_key(self, plant_id: int, ext: str) -> str:
        return f"plants/{plant_id}/{secrets.token_hex(16)}" + (f".{ext}" if ext else "")

    def _path(self, key: str) -> Path:
        if self.root is None:
            raise HTTPException(503, "This document is stored on disk, but no document root is configured")
        if not _STORAGE_KEY.match(key):
            raise HTTPException(500, "Refusing to read a document with an unrecognised storage key")
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise HTTPException(500, "Refusing to read a document outside the document root")
        return path

    # -- writing
    def read_upload(self, upload: UploadFile) -> tuple[bytes, str, int]:
        """Read the upload, enforcing the size limit while reading rather than after."""
        digest = hashlib.sha256()
        size = 0
        parts: list[bytes] = []
        while chunk := upload.file.read(CHUNK):
            size += len(chunk)
            if size > self.max_bytes:
                raise HTTPException(413, f"The file is larger than the {self.max_bytes // (1024 * 1024)} MB limit")
            digest.update(chunk)
            parts.append(chunk)
        if size == 0:
            raise HTTPException(422, "The file is empty")
        return b"".join(parts), digest.hexdigest(), size

    def put(self, conn, document_id: int, key: str, data: bytes, sha256: str, size: int) -> StoredFile:
        if self.backend == "db":
            conn.execute("INSERT INTO plant_document_blobs (document_id, bytes) VALUES (%s, %s)",
                         (document_id, data))
        else:
            path = self._path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(path.name + ".part")
            tmp.write_bytes(data)
            tmp.replace(path)
        return StoredFile(sha256, size, self.backend, key)

    def replace(self, conn, document_id: int, key: str, data: bytes, sha256: str, size: int) -> StoredFile:
        """New bytes for an existing document (a revised drawing keeps its id and links)."""
        if self.backend == "db":
            conn.execute("""INSERT INTO plant_document_blobs (document_id, bytes) VALUES (%s, %s)
                            ON CONFLICT (document_id) DO UPDATE SET bytes = EXCLUDED.bytes""",
                         (document_id, data))
            return StoredFile(sha256, size, "db", key)
        return self.put(conn, document_id, key, data, sha256, size)

    # -- reading. The bytes are handed back whole rather than streamed from the
    # request's database connection: FastAPI releases a yielded dependency before
    # a streaming body is sent, so a generator reading from `conn` would race the
    # connection back into the pool. Uploads are size-capped, so this is bounded.
    def db_bytes(self, conn, doc: dict) -> bytes:
        row = conn.execute("SELECT bytes FROM plant_document_blobs WHERE document_id = %s",
                           (doc["id"],)).fetchone()
        if row is None:
            raise HTTPException(410, "The stored file for this document is missing")
        return bytes(row["bytes"])

    def fs_path(self, doc: dict) -> Path:
        path = self._path(doc["storage_key"])
        if not path.is_file():
            raise HTTPException(410, "The stored file for this document is missing from the document root")
        return path

    def discard(self, doc: dict) -> None:
        """Best-effort cleanup after the metadata row is gone. A leftover file is
        harmless (nothing references it); a deleted row with a live file is not."""
        if doc["storage"] != "fs" or self.root is None:
            return
        try:
            self._path(doc["storage_key"]).unlink(missing_ok=True)
        except (OSError, HTTPException):
            pass


def payload(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "plant_id": doc["plant_id"],
        "category": doc["category"],
        "category_label": CATEGORY_LABELS.get(doc["category"], doc["category"]),
        "title": doc["title"],
        "description": doc["description"],
        "file_name": doc["file_name"],
        "extension": extension_of(doc["file_name"]),
        "content_type": doc["content_type"],
        "byte_size": doc["byte_size"],
        "sha256": doc["sha256"],
        "can_preview": doc["content_type"] in INLINE_OK,
        "uploaded_by": doc["uploaded_by"],
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"],
        "href": f"/api/v1/plants/{doc['plant_id']}/documents/{doc['id']}",
        "download_href": f"/api/v1/plants/{doc['plant_id']}/documents/{doc['id']}/content",
    }
