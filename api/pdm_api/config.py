import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

ROLES = ("viewer", "editor", "admin")


@dataclass(frozen=True)
class Principal:
    name: str
    role: str


@dataclass
class Settings:
    database_url: str
    tokens: dict[str, Principal]  # sha256(token) hex digest -> principal
    pool_min_size: int = 1
    pool_max_size: int = 10

    @classmethod
    def from_env(cls) -> "Settings":
        dsn = os.environ.get("DATABASE_URL")
        if not dsn:
            raise RuntimeError("DATABASE_URL is not set")
        tokens_file = os.environ.get("PDM_API_TOKENS_FILE")
        if not tokens_file:
            raise RuntimeError("PDM_API_TOKENS_FILE is not set (see tools/make_token.py)")
        entries = json.loads(Path(tokens_file).read_text(encoding="utf-8"))
        return cls(
            database_url=dsn,
            tokens=load_tokens(entries),
            pool_min_size=int(os.environ.get("PDM_DB_POOL_MIN", 1)),
            pool_max_size=int(os.environ.get("PDM_DB_POOL_MAX", 10)),
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
