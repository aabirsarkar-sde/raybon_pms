from fastapi import Request
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import Settings


def make_pool(settings: Settings) -> ConnectionPool:
    return ConnectionPool(
        settings.database_url,
        min_size=settings.pool_min_size,
        max_size=settings.pool_max_size,
        open=False,
        kwargs={"autocommit": True, "row_factory": dict_row},
    )


def get_conn(request: Request):
    """One pooled connection per request (FastAPI caches this dependency within a request)."""
    with request.app.state.pool.connection() as conn:
        yield conn
