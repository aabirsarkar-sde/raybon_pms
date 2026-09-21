import re
from contextlib import contextmanager
from dataclasses import dataclass

import psycopg
from fastapi import Depends, HTTPException, Request

from .auth import require
from .config import Principal
from .pool import get_conn, make_pool  # noqa: F401  (re-exported)

_CONTROL = re.compile(r"[\x00-\x08\x0a-\x1f\x7f]")


@contextmanager
def read_tx(conn: psycopg.Connection):
    """Consistent snapshot for multi-query reads."""
    with conn.transaction():
        conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        yield


@dataclass
class WriteContext:
    conn: psycopg.Connection
    principal: Principal
    reason: str | None
    request_id: str

    @contextmanager
    def tx(self):
        """One transaction per request; audit context is visible to the log_change trigger."""
        with self.conn.transaction():
            self.conn.execute(
                "SELECT set_config('pdm.changed_by', %s, true),"
                "       set_config('pdm.change_reason', %s, true),"
                "       set_config('pdm.request_id', %s, true)",
                (self.principal.name, self.reason or "", self.request_id),
            )
            yield self.conn


def writer(role: str = "editor"):
    def dependency(request: Request, principal: Principal = Depends(require(role)),
                   conn: psycopg.Connection = Depends(get_conn)) -> WriteContext:
        reason = request.headers.get("X-Change-Reason")
        if reason is not None:
            if len(reason) > 500 or _CONTROL.search(reason):
                raise HTTPException(422, "X-Change-Reason must be at most 500 characters without control characters")
            reason = reason.strip() or None
        return WriteContext(conn, principal, reason, request.state.request_id)
    return dependency
