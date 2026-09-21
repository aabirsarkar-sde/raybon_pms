-- =============================================================================
-- 001 — User accounts and sessions (username/password sign-in with roles).
--
-- Apply once, as the schema owner, to an existing database:
--     psql "$OWNER_DSN" -f database/migrations/001_user_accounts.sql
--     psql "$OWNER_DSN" -f database/roles.sql          # grants for the new tables
-- Fresh installs: seed_from_json.py --apply-schema applies migrations/ after schema.sql.
--
-- Passwords are stored only as scrypt hashes (see api/pdm_api/accounts.py).
-- Session tokens are stored only as SHA-256 hashes.
-- =============================================================================

BEGIN;

CREATE TABLE app_users (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username             text        NOT NULL CHECK (username ~ '^[A-Za-z0-9._@-]{3,64}$'),
    display_name         text        CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 200),
    role                 text        NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
    password_hash        text        NOT NULL,
    is_active            boolean     NOT NULL DEFAULT true,
    failed_logins        integer     NOT NULL DEFAULT 0,
    locked_until         timestamptz,
    last_login_at        timestamptz,
    password_changed_at  timestamptz NOT NULL DEFAULT now(),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
-- Usernames are case-insensitive for sign-in.
CREATE UNIQUE INDEX app_users_username_key ON app_users (lower(username));

CREATE TABLE app_sessions (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       bigint      NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
    token_hash    text        NOT NULL UNIQUE,           -- sha256 of the bearer token
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at    timestamptz,
    user_agent    text,
    client_ip     text
);
CREATE INDEX app_sessions_user_idx ON app_sessions (user_id);
CREATE INDEX app_sessions_expires_idx ON app_sessions (expires_at);

-- updated_at reflects account changes only. Sign-in bookkeeping (failed attempts,
-- lockout, last login) must not bump it, or an admin's edit would be rejected as a
-- concurrent modification whenever the user merely signed in.
CREATE FUNCTION app_users_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    bookkeeping text[] := ARRAY['failed_logins', 'locked_until', 'last_login_at', 'updated_at'];
BEGIN
    IF (to_jsonb(NEW) - bookkeeping) IS DISTINCT FROM (to_jsonb(OLD) - bookkeeping) THEN
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER app_users_set_updated_at BEFORE UPDATE ON app_users
    FOR EACH ROW EXECUTE FUNCTION app_users_touch();

-- Audit account administration in change_log (who created a user, changed a role,
-- deactivated an account, reset a password). The password hash is never logged,
-- and sign-in bookkeeping (failed attempts, lockout, last login) is not logged.
CREATE FUNCTION log_user_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    hidden text[] := ARRAY['password_hash', 'failed_logins', 'locked_until', 'last_login_at', 'updated_at'];
    o      jsonb := to_jsonb(OLD) - hidden;
    n      jsonb := to_jsonb(NEW) - hidden;
    k      text;
    who    text := nullif(current_setting('pdm.changed_by', true), '');
    why    text := nullif(current_setting('pdm.change_reason', true), '');
    req    text := nullif(current_setting('pdm.request_id', true), '');
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO change_log (table_name, row_id, operation, new_row, changed_by, reason, request_id)
        VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', n, who, why, req);
        RETURN NEW;
    END IF;
    IF OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
        INSERT INTO change_log (table_name, row_id, operation, column_name, old_value, new_value, changed_by, reason, request_id)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', 'password', '"(hidden)"', '"(changed)"', who, why, req);
    END IF;
    FOR k IN SELECT key FROM jsonb_each(n) WHERE n->key IS DISTINCT FROM o->key LOOP
        INSERT INTO change_log (table_name, row_id, operation, column_name, old_value, new_value, changed_by, reason, request_id)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', k, o->k, n->k, who, why, req);
    END LOOP;
    RETURN NEW;
END $$;

CREATE TRIGGER AUDIT_app_users AFTER INSERT OR UPDATE ON app_users
    FOR EACH ROW EXECUTE FUNCTION log_user_change();

-- Accounts are deactivated, never deleted, so audit attributions stay meaningful.
CREATE TRIGGER app_users_no_delete BEFORE DELETE ON app_users
    FOR EACH ROW EXECUTE FUNCTION forbid_modification();

COMMIT;
