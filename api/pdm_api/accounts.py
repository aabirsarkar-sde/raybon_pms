"""
Password hashing and session tokens for username/password sign-in.

Passwords: scrypt (Python stdlib), per-password random salt, stored as
    scrypt$<n>$<r>$<p>$<salt b64>$<hash b64>
Sessions: random bearer token given to the client; only its SHA-256 is stored.
"""
import base64
import hashlib
import hmac
import secrets
from functools import lru_cache

N, R, P = 2**15, 8, 1
MAXMEM = 64 * 1024 * 1024

MIN_PASSWORD = 8
MAX_PASSWORD = 256

MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=N, r=R, p=P, maxmem=MAXMEM, dklen=32)
    return f"scrypt${N}${R}${P}${_b64(salt)}${_b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, expected = stored.split("$")
        if scheme != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p),
                            maxmem=MAXMEM, dklen=len(base64.b64decode(expected)))
        return hmac.compare_digest(dk, base64.b64decode(expected))
    except (ValueError, TypeError):
        return False


@lru_cache(maxsize=1)
def dummy_hash() -> str:
    """Verified against when the username does not exist, so timing does not reveal valid usernames."""
    return hash_password(secrets.token_urlsafe(16))


def password_problem(password: str, username: str | None = None) -> str | None:
    if len(password) < MIN_PASSWORD:
        return f"Password must be at least {MIN_PASSWORD} characters"
    if len(password) > MAX_PASSWORD:
        return f"Password must be at most {MAX_PASSWORD} characters"
    if username and password.lower() == username.lower():
        return "Password must not be the same as the username"
    return None


def new_session_token() -> str:
    return "pdms_" + secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
