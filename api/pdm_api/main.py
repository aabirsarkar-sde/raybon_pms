"""
Plant Data Management API.

Run:
    DATABASE_URL=postgresql://pdm_api@localhost/plantdata \
    PDM_API_TOKENS_FILE=api/tokens.json \
    uvicorn pdm_api.main:create_app --factory --app-dir api
"""
import logging
import re
import uuid
from contextlib import asynccontextmanager

import psycopg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from psycopg import errors as pgerr

from .config import Settings
from .db import make_pool
from .routes import router

log = logging.getLogger("pdm_api")
_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{1,100}$")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    pool = make_pool(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        pool.open(wait=True)
        try:
            yield
        finally:
            pool.close()

    app = FastAPI(
        title="Plant Data Management API",
        version="1.0.0",
        description="Editable plant data with immutable legacy provenance. See api/API.md.",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.pool = pool

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        rid = request.headers.get("X-Request-ID")
        if not rid or not _REQUEST_ID.match(rid):
            rid = uuid.uuid4().hex
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response

    # ---- database errors -> HTTP
    def handler(status: int, message: str):
        async def handle(request: Request, exc: Exception):
            detail = getattr(getattr(exc, "diag", None), "message_primary", None) or str(exc)
            if status >= 500:
                log.exception("database error", exc_info=exc)
            return JSONResponse({"detail": message, "database": detail}, status_code=status)
        return handle

    # Raised by the immutability triggers (SQLSTATE 23000)
    app.add_exception_handler(pgerr.IntegrityConstraintViolation,
                              handler(409, "Legacy source data is immutable"))
    app.add_exception_handler(pgerr.UniqueViolation, handler(409, "Conflicts with an existing record"))
    app.add_exception_handler(pgerr.ForeignKeyViolation, handler(409, "Referenced record missing or in use"))
    app.add_exception_handler(pgerr.CheckViolation, handler(422, "Value violates a database rule"))
    app.add_exception_handler(pgerr.InsufficientPrivilege, handler(403, "Not permitted by database policy"))
    app.add_exception_handler(psycopg.DataError, handler(422, "Invalid value"))
    app.add_exception_handler(psycopg.OperationalError, handler(503, "Database unavailable"))

    @app.get("/health", tags=["meta"])
    def health():
        with pool.connection() as conn:
            conn.execute("SELECT 1")
        return {"status": "ok"}

    app.include_router(router)
    return app
