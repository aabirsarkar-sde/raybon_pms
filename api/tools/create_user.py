"""
Create a user account, or reset an existing user's password (e.g. the first admin).

    DATABASE_URL=postgresql://... python api/tools/create_user.py admin --role admin
    # prompts for the password (not echoed, not stored in shell history)

    echo 'secret' | python api/tools/create_user.py admin --role admin --password-stdin

If the username already exists, its password (and role, if given) is reset and it is
unlocked and re-activated. Use the database owner or the pdm_api role.
"""
import argparse
import getpass
import os
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pdm_api.accounts import hash_password, password_problem  # noqa: E402

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("username")
ap.add_argument("--role", choices=["viewer", "editor", "admin"])
ap.add_argument("--display-name")
ap.add_argument("--password-stdin", action="store_true", help="read the password from standard input")
ap.add_argument("--dsn", default=os.environ.get("DATABASE_URL"))
args = ap.parse_args()
if not args.dsn:
    sys.exit("Provide --dsn or set DATABASE_URL")

if args.password_stdin:
    password = sys.stdin.readline().rstrip("\n")
else:
    password = getpass.getpass(f"Password for {args.username}: ")
    if getpass.getpass("Repeat password: ") != password:
        sys.exit("Passwords do not match")
problem = password_problem(password, args.username)
if problem:
    sys.exit(problem)

with psycopg.connect(args.dsn) as conn:
    conn.execute("SELECT set_config('pdm.changed_by', 'create_user.py', true)")
    row = conn.execute("SELECT id, role FROM app_users WHERE lower(username) = lower(%s)", (args.username,)).fetchone()
    if row:
        conn.execute(
            """UPDATE app_users SET password_hash = %s, password_changed_at = now(), failed_logins = 0,
                   locked_until = NULL, is_active = true, role = coalesce(%s, role),
                   display_name = coalesce(%s, display_name) WHERE id = %s""",
            (hash_password(password), args.role, args.display_name, row[0]),
        )
        conn.execute("UPDATE app_sessions SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL", (row[0],))
        print(f"Updated user '{args.username}' (role: {args.role or row[1]}); existing sessions signed out.")
    else:
        if not args.role:
            sys.exit("--role is required for a new user")
        conn.execute(
            "INSERT INTO app_users (username, display_name, role, password_hash) VALUES (%s, %s, %s, %s)",
            (args.username, args.display_name, args.role, hash_password(password)),
        )
        print(f"Created user '{args.username}' with role {args.role}.")
