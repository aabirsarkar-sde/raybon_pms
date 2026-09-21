"""
Test harness.

Requires a PostgreSQL superuser DSN in PDM_TEST_ADMIN_DSN. A template database
is built once (schema.sql + full seed + roles.sql); every test gets a fresh
copy of it and talks to it as the least-privilege `pdm_api` role.
"""
import importlib.util
import json
import os
import uuid
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.conninfo import make_conninfo

from pdm_api.config import Settings, hash_token, load_tokens
from pdm_api.main import create_app

ROOT = Path(__file__).resolve().parents[2]
ADMIN_DSN = os.environ.get("PDM_TEST_ADMIN_DSN")
TOKENS = {"viewer": "t-viewer", "editor": "t-editor", "admin": "t-admin"}

if not ADMIN_DSN:
    pytest.exit("Set PDM_TEST_ADMIN_DSN to a PostgreSQL superuser DSN", returncode=2)


def _admin(dbname="postgres"):
    return psycopg.connect(make_conninfo(ADMIN_DSN, dbname=dbname), autocommit=True)


def _load_seed_module():
    spec = importlib.util.spec_from_file_location("seed", ROOT / "database/seed/seed_from_json.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="session")
def template_db():
    name = f"pdm_tpl_{uuid.uuid4().hex[:8]}"
    with _admin() as c:
        c.execute(f'CREATE DATABASE "{name}"')
    seed = _load_seed_module()
    with _admin(name) as c:
        c.execute((ROOT / "database/schema.sql").read_text())
        seed.run_import(c, seed.load_records())
        c.execute((ROOT / "database/roles.sql").read_text())
    yield name
    with _admin() as c:
        c.execute(f'DROP DATABASE "{name}" WITH (FORCE)')


@pytest.fixture
def db(template_db):
    name = f"pdm_t_{uuid.uuid4().hex[:8]}"
    with _admin() as c:
        c.execute(f'CREATE DATABASE "{name}" TEMPLATE "{template_db}"')
    yield name
    with _admin() as c:
        c.execute(f'DROP DATABASE "{name}" WITH (FORCE)')


@pytest.fixture
def admin_conn(db):
    """Superuser connection to the test database (for checks the API must not be able to do)."""
    with _admin(db) as c:
        yield c


@pytest.fixture
def api_dsn(db):
    return make_conninfo(ADMIN_DSN, dbname=db, user="pdm_api")


@pytest.fixture
def api_conn(api_dsn):
    with psycopg.connect(api_dsn, autocommit=True) as c:
        yield c


@pytest.fixture
def client(api_dsn):
    settings = Settings(
        database_url=api_dsn,
        tokens=load_tokens([{"name": f"{role}-user", "role": role, "token_sha256": hash_token(tok)}
                            for role, tok in TOKENS.items()]),
        pool_min_size=1, pool_max_size=4,
    )
    with TestClient(create_app(settings)) as c:
        yield c


def auth(role: str, reason: str | None = None) -> dict:
    h = {"Authorization": f"Bearer {TOKENS[role]}"}
    if reason:
        h["X-Change-Reason"] = reason
    return h


def structured(legacy_id: int) -> dict:
    return json.loads((ROOT / f"plantdata_export/structured/plant_{legacy_id}.json").read_text())
