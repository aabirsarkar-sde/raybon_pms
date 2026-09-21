from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Principal, hash_token

ROLE_RANK = {"viewer": 1, "editor": 2, "admin": 3}

_bearer = HTTPBearer(auto_error=False)


def current_principal(
    request: Request, creds: HTTPAuthorizationCredentials | None = Depends(_bearer)
) -> Principal:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token",
                            headers={"WWW-Authenticate": "Bearer"})
    principal = request.app.state.settings.tokens.get(hash_token(creds.credentials))
    if principal is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token",
                            headers={"WWW-Authenticate": "Bearer"})
    return principal


def require(role: str):
    def dependency(principal: Principal = Depends(current_principal)) -> Principal:
        if ROLE_RANK[principal.role] < ROLE_RANK[role]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"This action requires the '{role}' role")
        return principal
    return dependency
