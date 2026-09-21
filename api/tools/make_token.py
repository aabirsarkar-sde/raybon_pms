"""
Create an API token and print (1) the secret token to hand to the user and
(2) the entry to add to the tokens file. Only the SHA-256 hash is stored.

    python api/tools/make_token.py alice editor
"""
import hashlib
import json
import secrets
import sys

ROLES = ("viewer", "editor", "admin")

if len(sys.argv) != 3 or sys.argv[2] not in ROLES:
    sys.exit(f"usage: make_token.py <name> <{'|'.join(ROLES)}>")

name, role = sys.argv[1], sys.argv[2]
token = "pdm_" + secrets.token_urlsafe(32)
print("Token (give to the user; it is not stored anywhere):")
print(f"  {token}\n")
print("Add to the tokens file (JSON array):")
print("  " + json.dumps({"name": name, "role": role,
                         "token_sha256": hashlib.sha256(token.encode()).hexdigest()}))
