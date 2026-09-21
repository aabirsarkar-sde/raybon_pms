import psycopg
import pytest

from conftest import PASSWORDS, auth

P = "/api/v1"


def login(client, username, password=None):
    return client.post(f"{P}/auth/login", json={"username": username, "password": password or PASSWORDS[username]})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def session(client, username):
    r = login(client, username)
    assert r.status_code == 200, r.text
    return bearer(r.json()["token"])


def user_id(client, username):
    users = client.get(f"{P}/users", headers=session(client, "alice")).json()["items"]
    return next(u["id"] for u in users if u["username"] == username)


# ------------------------------------------------------------------ sign-in
def test_login_and_me(client):
    r = login(client, "EDDIE", PASSWORDS["eddie"])  # usernames are case-insensitive
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"].startswith("pdms_") and body["expires_at"]
    assert body["user"] == {"name": "eddie", "username": "eddie", "display_name": None, "role": "editor", "auth": "password"}
    assert client.get(f"{P}/me", headers=bearer(body["token"])).json()["role"] == "editor"


def test_bad_credentials_are_indistinguishable(client):
    wrong = login(client, "eddie", "nope-nope")
    unknown = login(client, "nobody", "nope-nope")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "Invalid username or password"}
    assert client.get(f"{P}/plants", headers=bearer("pdms_forged")).status_code == 401


def test_lockout_and_admin_unlock(client):
    for _ in range(4):
        assert login(client, "vera", "wrong-password").status_code == 401
    assert login(client, "vera", "wrong-password").status_code == 429
    assert login(client, "vera").status_code == 429  # even the right password while locked
    admin = session(client, "alice")
    vid = user_id(client, "vera")
    assert client.get(f"{P}/users", headers=admin).json()["items"][-1] is not None
    r = client.patch(f"{P}/users/{vid}", json={"unlock": True}, headers=admin)
    assert r.status_code == 200 and r.json()["locked"] is False
    assert login(client, "vera").status_code == 200


def test_logout_and_expiry(client, admin_conn):
    h = session(client, "eddie")
    assert client.post(f"{P}/auth/logout", headers=h).status_code == 204
    assert client.get(f"{P}/me", headers=h).status_code == 401
    h2 = session(client, "eddie")
    admin_conn.execute("UPDATE app_sessions SET expires_at = now() - interval '1 minute'")
    assert client.get(f"{P}/me", headers=h2).status_code == 401


# ------------------------------------------------------------------ roles take effect immediately
def test_role_change_and_deactivation_apply_to_open_sessions(client):
    vera = session(client, "vera")
    pid = client.get(f"{P}/plants/by-legacy-id/1", headers=vera).json()["id"]
    assert client.patch(f"{P}/plants/{pid}", json={"capacity": "x1"}, headers=vera).status_code == 403
    admin = session(client, "alice")
    vid = user_id(client, "vera")
    assert client.patch(f"{P}/users/{vid}", json={"role": "editor"}, headers={**admin, "X-Change-Reason": "Promoted"}).status_code == 200
    assert client.patch(f"{P}/plants/{pid}", json={"capacity": "x1"}, headers=vera).status_code == 200
    # the edit is attributed to the username
    hist = client.get(f"{P}/plants/{pid}/history", headers=vera).json()["items"]
    assert hist[0]["changed_by"] == "vera"
    assert client.patch(f"{P}/users/{vid}", json={"is_active": False}, headers=admin).status_code == 200
    assert client.get(f"{P}/me", headers=vera).status_code == 401
    assert login(client, "vera").status_code == 401


# ------------------------------------------------------------------ passwords
def test_change_password_signs_out_other_devices(client):
    phone, laptop = session(client, "eddie"), session(client, "eddie")
    r = client.post(f"{P}/auth/change-password", json={"current_password": "wrong", "new_password": "brand-new-pass"}, headers=laptop)
    assert r.status_code == 422
    r = client.post(f"{P}/auth/change-password", json={"current_password": PASSWORDS["eddie"], "new_password": "short"}, headers=laptop)
    assert r.status_code == 422
    r = client.post(f"{P}/auth/change-password", json={"current_password": PASSWORDS["eddie"], "new_password": "brand-new-pass"}, headers=laptop)
    assert r.status_code == 204
    assert client.get(f"{P}/me", headers=laptop).status_code == 200
    assert client.get(f"{P}/me", headers=phone).status_code == 401
    assert login(client, "eddie").status_code == 401
    assert login(client, "eddie", "brand-new-pass").status_code == 200


def test_admin_reset_password(client):
    eddie = session(client, "eddie")
    admin = session(client, "alice")
    eid = user_id(client, "eddie")
    assert client.post(f"{P}/users/{eid}/password", json={"new_password": "eddie"}, headers=admin).status_code == 422
    assert client.post(f"{P}/users/{eid}/password", json={"new_password": "reset-by-admin"}, headers=admin).status_code == 200
    assert client.get(f"{P}/me", headers=eddie).status_code == 401
    assert login(client, "eddie", "reset-by-admin").status_code == 200


# ------------------------------------------------------------------ user administration
def test_user_admin_is_admin_only(client):
    eddie = session(client, "eddie")
    assert client.get(f"{P}/users", headers=eddie).status_code == 403
    assert client.post(f"{P}/users", json={"username": "x-user", "role": "viewer", "password": "long-enough"}, headers=eddie).status_code == 403


def test_create_user_rules(client):
    admin = session(client, "alice")
    r = client.post(f"{P}/users", json={"username": "new.user", "display_name": "New User", "role": "viewer",
                                       "password": "long-enough"}, headers=admin)
    assert r.status_code == 201, r.text
    assert "password_hash" not in r.json() and r.json()["is_active"] is True
    assert client.post(f"{P}/users", json={"username": "NEW.USER", "role": "viewer", "password": "long-enough"},
                       headers=admin).status_code == 409
    for bad in [{"username": "a", "role": "viewer", "password": "long-enough"},
                {"username": "has space", "role": "viewer", "password": "long-enough"},
                {"username": "okname", "role": "superuser", "password": "long-enough"},
                {"username": "okname", "role": "viewer", "password": "short"},
                {"username": "okname", "role": "viewer", "password": "okname"}]:
        assert client.post(f"{P}/users", json=bad, headers=admin).status_code == 422, bad
    assert login(client, "new.user", "long-enough").json()["user"]["display_name"] == "New User"


def test_admin_safety_rules(client):
    admin = session(client, "alice")
    aid = user_id(client, "alice")
    assert client.patch(f"{P}/users/{aid}", json={"is_active": False}, headers=admin).status_code == 409
    assert client.patch(f"{P}/users/{aid}", json={"role": "viewer"}, headers=admin).status_code == 409
    # promote eddie, then eddie cannot demote the other admin if it would leave none
    eid = user_id(client, "eddie")
    client.patch(f"{P}/users/{eid}", json={"role": "admin"}, headers=admin)
    eddie = session(client, "eddie")
    assert client.patch(f"{P}/users/{aid}", json={"role": "editor"}, headers=eddie).status_code == 200
    assert client.patch(f"{P}/users/{eid}", json={"role": "editor"}, headers=eddie).status_code == 409  # own role


def test_account_changes_are_audited_without_secrets(client, admin_conn):
    admin = session(client, "alice")
    vid = user_id(client, "vera")
    client.patch(f"{P}/users/{vid}", json={"role": "editor"}, headers={**admin, "X-Change-Reason": "Promoted"})
    client.post(f"{P}/users/{vid}/password", json={"new_password": "another-pass"}, headers=admin)
    rows = admin_conn.execute(
        "SELECT column_name, old_value, new_value, changed_by, reason FROM change_log WHERE table_name = 'app_users' ORDER BY id"
    ).fetchall()
    assert ("role", "viewer", "editor", "alice", "Promoted") in rows
    assert any(r[0] == "password" and r[2] == "(changed)" for r in rows)
    everything = admin_conn.execute("SELECT string_agg(to_jsonb(c)::text, ' ') FROM change_log c").fetchone()[0]
    assert "scrypt$" not in everything and "token_hash" not in everything


def test_accounts_cannot_be_deleted(admin_conn, api_conn):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        api_conn.execute("DELETE FROM app_users")
    with pytest.raises(psycopg.errors.IntegrityConstraintViolation):
        admin_conn.execute("DELETE FROM app_users WHERE username = 'vera'")


def test_service_tokens_still_work(client):
    assert client.get(f"{P}/me", headers=auth("editor")).json()["auth"] == "token"


def test_sign_in_does_not_cause_false_edit_conflicts(client):
    admin = session(client, "alice")
    listed = next(u for u in client.get(f"{P}/users", headers=admin).json()["items"] if u["username"] == "vera")
    login(client, "vera", "wrong-password")  # failed attempt
    login(client, "vera")                    # successful sign-in
    r = client.patch(f"{P}/users/{listed['id']}", json={"display_name": "Vera", "expected_updated_at": listed["updated_at"]},
                     headers=admin)
    assert r.status_code == 200, r.text
