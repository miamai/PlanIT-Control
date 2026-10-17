from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.models.entities import UserAccount, UserStatus
from app.services.auth import decode_token


@dataclass(frozen=True)
class Principal:
    user_id: uuid.UUID
    subject: str
    role: str
    claims: dict


ROLE_LEVEL = {"crew": 1, "supervisor": 2, "admin": 3}
bearer_scheme = HTTPBearer(auto_error=False)


async def get_principal(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: AsyncSession = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Principal:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer access token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    try:
        claims = decode_token(token, settings, "access")
        user_id = uuid.UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired access token") from exc
    user = await session.get(UserAccount, user_id)
    if not user or user.deleted_at is not None or user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=401, detail="Account is unavailable")
    return Principal(
        user_id=user.id,
        subject=user.username,
        role=user.role.value,
        claims=claims,
    )


def require_role(required: str):
    async def dependency(principal: Principal = Depends(get_principal)) -> Principal:
        if ROLE_LEVEL[principal.role] < ROLE_LEVEL[required]:
            raise HTTPException(status_code=403, detail=f"{required} role required")
        return principal

    return dependency


AuthenticatedPrincipal = Annotated[Principal, Depends(get_principal)]
CrewPrincipal = Annotated[Principal, Depends(require_role("crew"))]
SupervisorPrincipal = Annotated[Principal, Depends(require_role("supervisor"))]
AdminPrincipal = Annotated[Principal, Depends(require_role("admin"))]
