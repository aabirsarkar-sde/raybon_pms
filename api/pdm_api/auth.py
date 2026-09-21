"""
Authentication and role checks.

A bearer credential is either
  * a session token issued by POST /auth/login (username + password), looked up in
    app_sessions; the user's *current* role and active flag are read on every request,
    so role changes and deactivation take effect immediately; or
  * an optional static service token from PDM_API_TOKENS_FILE (scripts, automation).
"""
from datetime import datetime, timedelta, timezone

import psycopg
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .accounts import token_digest
from .config import Principal, hash_token
from .pool import get_conn

ROLE_RANK = {"viewer": 1, "editor": 2, "admin": 3}
_TOUCH_EVERY = timedelta(minutes=5)

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"})


def current_principal(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    conn: psycopg.Connection = Depends(get_conn),
) -> Principal:
    if creds is None:
        raise _unauthorized("Not signed in")
    token = creds.credentials

    service = request.app.state.settings.tokens.get(hash_token(token))
    if service is not None:
        return service

    row = conn.execute(
        """SELECT s.id AS session_id, s.last_seen_at, u.id AS user_id, u.username, u.display_name, u.role
           FROM app_sessions s JOIN app_users u ON u.id = s.user_id
           WHERE s.token_hash = %s AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active""",
        (token_digest(token),),
    ).fetchone()
    if row is None:
        raise _unauthorized("Session expired or invalid; please sign in again")
    if datetime.now(timezone.utc) - row["last_seen_at"] > _TOUCH_EVERY:
        conn.execute("UPDATE app_sessions SET last_seen_at = now() WHERE id = %s", (row["session_id"],))
    return Principal(
        name=row["username"],
        role=row["role"],
        user_id=row["user_id"],
        display_name=row["display_name"],
        session_id=row["session_id"],
    )


def require(role: str):
    def dependency(principal: Principal = Depends(current_principal)) -> Principal:
        if ROLE_RANK[principal.role] < ROLE_RANK[role]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"This action requires the '{role}' role")
        return principal
    return dependency
