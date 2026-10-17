from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from jwt import PyJWKClient

from app.core.config import Settings, get_settings


@dataclass(frozen=True)
class Principal:
    subject: str
    role: str
    claims: dict


ROLE_LEVEL = {"crew": 1, "supervisor": 2, "admin": 3}


async def get_principal(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(get_settings),
) -> Principal:
    if settings.auth_mode == "development" and settings.environment != "production":
        role = request.headers.get("X-PlanIT-Role", "admin")
        if role not in ROLE_LEVEL:
            raise HTTPException(status_code=403, detail="Unknown development role")
        return Principal(request.headers.get("X-PlanIT-Subject", "local-developer"), role, {})

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required"
        )
    token = authorization.removeprefix("Bearer ").strip()
    try:
        key = PyJWKClient(settings.clerk_jwks_url).get_signing_key_from_jwt(token).key
        options = {"verify_aud": bool(settings.clerk_audience)}
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=settings.clerk_audience,
            issuer=settings.clerk_issuer,
            options=options,
        )
        if (
            settings.clerk_authorized_parties
            and claims.get("azp") not in settings.clerk_authorized_parties
        ):
            raise jwt.InvalidTokenError("Unauthorized party")
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc
    role = claims.get("planit_role", "crew")
    if role not in ROLE_LEVEL:
        raise HTTPException(status_code=403, detail="Token has no recognized PlanIT role")
    return Principal(subject=claims["sub"], role=role, claims=claims)


def require_role(required: str):
    async def dependency(principal: Principal = Depends(get_principal)) -> Principal:
        if ROLE_LEVEL[principal.role] < ROLE_LEVEL[required]:
            raise HTTPException(status_code=403, detail=f"{required} role required")
        return principal

    return dependency


CrewPrincipal = Annotated[Principal, Depends(require_role("crew"))]
SupervisorPrincipal = Annotated[Principal, Depends(require_role("supervisor"))]
AdminPrincipal = Annotated[Principal, Depends(require_role("admin"))]
