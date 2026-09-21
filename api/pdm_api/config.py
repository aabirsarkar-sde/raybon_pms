import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

ROLES = ("viewer", "editor", "admin")


@dataclass(frozen=True)
class Principal:
    name: str                      # username (or token name); recorded as changed_by in the audit log
    role: str
    user_id: int | None = None     # set for signed-in users; None for API tokens
    display_name: str | None = None
    session_id: int | None = None


@dataclass
class Settings:
    database_url: str
    tokens: dict[str, Principal]  # sha256(token) hex digest -> principal (optional service tokens)
    pool_min_size: int = 1
    pool_max_size: int = 10
    session_hours: float = 12

    @classmethod
    def from_env(cls) -> "Settings":
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL is not set")
        # Optional: static API tokens for scripts/service accounts. People sign in with a username and password.
        tokens_file = os.environ.get("PDM_API_TOKENS_FILE")
        entries = json.loads(Path(tokens_file).read_text(encoding="utf-8")) if tokens_file else []
        return cls(
            database_url=dsn,
            tokens=load_tokens(entries),
            pool_min_size=int(os.environ.get("PDM_DB_POOL_MIN", 1)),
            pool_max_size=int(os.environ.get("PDM_DB_POOL_MAX", 10)),
            session_hours=float(os.environ.get("PDM_SESSION_HOURS", 12)),
        )


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def load_tokens(entries: list[dict]) -> dict[str, Principal]:
    """entries: [{"name": "alice", "role": "editor", "token_sha256": "<hex>"}]"""
    out = {}
    for e in entries:
        if e["role"] not in ROLES:
            raise ValueError(f"Unknown role {e['role']!r} for {e['name']!r}")
        digest = e["token_sha256"].lower()
        if len(digest) != 64:
            raise ValueError(f"token_sha256 for {e['name']!r} is not a SHA-256 hex digest")
        out[digest] = Principal(e["name"], e["role"])
    return out
