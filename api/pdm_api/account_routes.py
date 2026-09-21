"""Sign-in, sessions and user administration (role-based access)."""
from datetime import datetime, timezone
from typing import Annotated, Literal, Optional

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from .accounts import (LOCKOUT_MINUTES, MAX_FAILED_LOGINS, dummy_hash, hash_password, new_session_token,
                       password_problem, token_digest, verify_password)
from .auth import current_principal, require
from .config import Principal
from .db import WriteContext, get_conn, writer
from .models import PatchBase, Text
from .repository import API_PREFIX

router = APIRouter(prefix=API_PREFIX)

Role = Literal["viewer", "editor", "admin"]
Username = Annotated[str, Field(pattern=r"^[A-Za-z0-9._@-]{3,64}$",
                                description="3–64 characters: letters, digits, . _ @ -")]
Password = Annotated[str, Field(min_length=1, max_length=256)]
BAD_LOGIN = "Invalid username or password"


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginBody(_Body):
    username: Annotated[str, Field(min_length=1, max_length=100)]
    password: Password


class ChangePasswordBody(_Body):
    current_password: Password
    new_password: Password


class UserCreate(_Body):
    username: Username
    display_name: Optional[Text] = None
    role: Role
    password: Password


class UserPatch(PatchBase):
    display_name: Optional[Text] = None
    role: Role = None  # type: ignore[assignment]
    is_active: StrictBool = None  # type: ignore[assignment]
    unlock: StrictBool = None  # type: ignore[assignment]


class PasswordReset(_Body):
    new_password: Password


def me_payload(p: Principal) -> dict:
    return {
        "name": p.name,
        "username": p.name,
        "display_name": p.display_name,
        "role": p.role,
        "auth": "password" if p.user_id is not None else "token",
    }


def user_payload(u: dict) -> dict:
    return {
        "id": u["id"],
        "username": u["username"],
        "display_name": u["display_name"],
        "role": u["role"],
        "is_active": u["is_active"],
        "locked": u["locked_until"] is not None and u["locked_until"] > datetime.now(timezone.utc),
        "last_login_at": u["last_login_at"],
        "password_changed_at": u["password_changed_at"],
        "created_at": u["created_at"],
        "updated_at": u["updated_at"],
    }


def _check_password(pw: str, username: str) -> None:
    problem = password_problem(pw, username)
    if problem:
        raise HTTPException(422, problem)


# ============================================================== sign-in
@router.post("/auth/login", tags=["auth"])
def login(body: LoginBody, request: Request, conn: psycopg.Connection = Depends(get_conn)):
    settings = request.app.state.settings
    outcome: tuple[str, dict | None] = ("bad", None)
    with conn.transaction():
        u = conn.execute("SELECT * FROM app_users WHERE lower(username) = lower(%s) FOR UPDATE",
                         (body.username,)).fetchone()
        now = datetime.now(timezone.utc)
        if u is None or not u["is_active"]:
            verify_password(body.password, dummy_hash())  # same cost as a real check
        elif u["locked_until"] is not None and u["locked_until"] > now:
            outcome = ("locked", None)
        elif not verify_password(body.password, u["password_hash"]):
            failed = u["failed_logins"] + 1
            if failed >= MAX_FAILED_LOGINS:
                conn.execute("""UPDATE app_users SET failed_logins = 0,
                                    locked_until = now() + make_interval(mins => %s) WHERE id = %s""",
                             (LOCKOUT_MINUTES, u["id"]))
                outcome = ("locked", None)
            else:
                conn.execute("UPDATE app_users SET failed_logins = %s WHERE id = %s", (failed, u["id"]))
        else:
            token = new_session_token()
            conn.execute("UPDATE app_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = %s",
                         (u["id"],))
            s = conn.execute(
                """INSERT INTO app_sessions (user_id, token_hash, expires_at, user_agent, client_ip)
                   VALUES (%s, %s, now() + make_interval(secs => %s), %s, %s) RETURNING expires_at""",
                (u["id"], token_digest(token), settings.session_hours * 3600,
                 (request.headers.get("user-agent") or "")[:300] or None,
                 request.headers.get("x-forwarded-for", request.client.host if request.client else "")[:100] or None),
            ).fetchone()
            conn.execute("DELETE FROM app_sessions WHERE expires_at < now() - interval '7 days'")
            outcome = ("ok", {
                "token": token,
                "expires_at": s["expires_at"],
                "user": me_payload(Principal(u["username"], u["role"], u["id"], u["display_name"])),
            })
    # Raised after commit so failed-attempt counters are saved.
    if outcome[0] == "locked":
        raise HTTPException(429, f"Too many failed sign-in attempts. Try again in {LOCKOUT_MINUTES} minutes "
                                 "or ask an administrator to unlock the account.")
    if outcome[0] == "bad":
        raise HTTPException(401, BAD_LOGIN)
    return outcome[1]


@router.post("/auth/logout", tags=["auth"], status_code=204)
def logout(principal: Principal = Depends(current_principal), conn: psycopg.Connection = Depends(get_conn)):
    if principal.session_id is not None:
        conn.execute("UPDATE app_sessions SET revoked_at = now() WHERE id = %s", (principal.session_id,))
    return Response(status_code=204)


@router.get("/me", tags=["auth"])
def me(principal: Principal = Depends(current_principal)):
    return me_payload(principal)


@router.post("/auth/change-password", tags=["auth"], status_code=204)
def change_password(body: ChangePasswordBody, ctx: WriteContext = Depends(writer("viewer"))):
    p = ctx.principal
    if p.user_id is None:
        raise HTTPException(400, "API tokens have no password")
    _check_password(body.new_password, p.name)
    with ctx.tx() as conn:
        u = conn.execute("SELECT password_hash FROM app_users WHERE id = %s FOR UPDATE", (p.user_id,)).fetchone()
        if not verify_password(body.current_password, u["password_hash"]):
            raise HTTPException(422, "Current password is incorrect")
        conn.execute("UPDATE app_users SET password_hash = %s, password_changed_at = now() WHERE id = %s",
                     (hash_password(body.new_password), p.user_id))
        # Sign out every other device.
        conn.execute("UPDATE app_sessions SET revoked_at = now() WHERE user_id = %s AND id <> %s AND revoked_at IS NULL",
                     (p.user_id, p.session_id))
    return Response(status_code=204)


# ============================================================== user administration (admin)
@router.get("/users", tags=["users"], dependencies=[Depends(require("admin"))])
def list_users(conn: psycopg.Connection = Depends(get_conn)):
    rows = conn.execute("SELECT * FROM app_users ORDER BY is_active DESC, lower(username)").fetchall()
    return {"items": [user_payload(u) for u in rows]}


@router.post("/users", tags=["users"], status_code=201)
def create_user(body: UserCreate, ctx: WriteContext = Depends(writer("admin"))):
    _check_password(body.password, body.username)
    with ctx.tx() as conn:
        if conn.execute("SELECT 1 FROM app_users WHERE lower(username) = lower(%s)", (body.username,)).fetchone():
            raise HTTPException(409, f"Username '{body.username}' is already taken")
        u = conn.execute(
            """INSERT INTO app_users (username, display_name, role, password_hash)
               VALUES (%s, %s, %s, %s) RETURNING *""",
            (body.username, body.display_name, body.role, hash_password(body.password)),
        ).fetchone()
        return user_payload(u)


def _fetch_user(conn, user_id: int) -> dict:
    u = conn.execute("SELECT * FROM app_users WHERE id = %s FOR UPDATE", (user_id,)).fetchone()
    if u is None:
        raise HTTPException(404, f"User {user_id} not found")
    return u


@router.patch("/users/{user_id}", tags=["users"])
def update_user(user_id: int, body: UserPatch, ctx: WriteContext = Depends(writer("admin"))):
    try:
        changes = body.changes()
    except ValueError as e:
        raise HTTPException(422, str(e))
    for k in ("role", "is_active", "unlock"):
        if k in changes and changes[k] is None:
            raise HTTPException(422, f"{k} cannot be null")
    unlock = changes.pop("unlock", False)
    with ctx.tx() as conn:
        u = _fetch_user(conn, user_id)
        if body.expected_updated_at is not None and u["updated_at"] != body.expected_updated_at:
            raise HTTPException(409, {"message": "The user was modified by someone else; reload and retry."})
        if u["id"] == ctx.principal.user_id and (
                changes.get("is_active") is False or changes.get("role", u["role"]) != u["role"]):
            raise HTTPException(409, "You cannot deactivate your own account or change your own role; ask another admin")
        loses_admin = u["role"] == "admin" and u["is_active"] and (
            changes.get("role", "admin") != "admin" or changes.get("is_active") is False)
        if loses_admin:
            others = conn.execute("SELECT count(*) AS n FROM app_users WHERE role = 'admin' AND is_active AND id <> %s",
                                  (user_id,)).fetchone()["n"]
            if others == 0:
                raise HTTPException(409, "At least one active admin is required")
        sets = dict(changes)
        if unlock:
            sets.update(failed_logins=0, locked_until=None)
        if sets:
            cols = ", ".join(f"{k} = %s" for k in sets)
            conn.execute(f"UPDATE app_users SET {cols} WHERE id = %s", [*sets.values(), user_id])
        if changes.get("is_active") is False:
            conn.execute("UPDATE app_sessions SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL", (user_id,))
        return user_payload(conn.execute("SELECT * FROM app_users WHERE id = %s", (user_id,)).fetchone())


@router.post("/users/{user_id}/password", tags=["users"])
def reset_password(user_id: int, body: PasswordReset, ctx: WriteContext = Depends(writer("admin"))):
    with ctx.tx() as conn:
        u = _fetch_user(conn, user_id)
        _check_password(body.new_password, u["username"])
        conn.execute("""UPDATE app_users SET password_hash = %s, password_changed_at = now(),
                            failed_logins = 0, locked_until = NULL WHERE id = %s""",
                     (hash_password(body.new_password), user_id))
        conn.execute("UPDATE app_sessions SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL", (user_id,))
        return user_payload(conn.execute("SELECT * FROM app_users WHERE id = %s", (user_id,)).fetchone())
