from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AdminPrincipal, AuthenticatedPrincipal
from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.models.entities import UserAccount, UserRole, UserStatus
from app.schemas.domain import (
    Envelope,
    LoginRequest,
    PageMeta,
    TokenResponse,
    UserCreate,
    UserRead,
    UserUpdate,
)
from app.services.auth import (
    hash_password,
    issue_token_pair,
    normalize_username,
    revoke_refresh_token,
    revoke_user_sessions,
    rotate_refresh_token,
    verify_password,
)

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_session)]


def _set_refresh_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        settings.refresh_cookie_name,
        token,
        max_age=settings.refresh_token_days * 86400,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path="/api/auth",
    )


def _token_response(user: UserAccount, token: str, expires_in: int) -> TokenResponse:
    return TokenResponse(
        access_token=token,
        expires_in=expires_in,
        user=UserRead.model_validate(user),
    )


@router.post("/api/auth/login", response_model=TokenResponse, tags=["auth"])
async def login(
    body: LoginRequest,
    response: Response,
    session: DbSession,
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    user = await session.scalar(
        select(UserAccount).where(UserAccount.username == normalize_username(body.username))
    )
    if (
        not user
        or user.deleted_at is not None
        or user.status != UserStatus.ACTIVE
        or not verify_password(body.password, user.password_hash)
    ):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    access, refresh, expires_in, _ = await issue_token_pair(session, user, settings)
    await session.commit()
    _set_refresh_cookie(response, refresh, settings)
    return _token_response(user, access, expires_in)


@router.post("/api/auth/refresh", response_model=TokenResponse, tags=["auth"])
async def refresh(
    request: Request,
    response: Response,
    session: DbSession,
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    token = request.cookies.get(settings.refresh_cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Refresh token cookie required")
    try:
        user, access, replacement, expires_in = await rotate_refresh_token(session, token, settings)
    except (jwt.PyJWTError, ValueError, KeyError) as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token") from exc
    await session.commit()
    _set_refresh_cookie(response, replacement, settings)
    return _token_response(user, access, expires_in)


@router.post("/api/auth/logout", status_code=204, tags=["auth"])
async def logout(
    _: AuthenticatedPrincipal,
    request: Request,
    response: Response,
    session: DbSession,
    settings: Settings = Depends(get_settings),
) -> Response:
    refresh_token = request.cookies.get(settings.refresh_cookie_name)
    if refresh_token:
        await revoke_refresh_token(session, refresh_token, settings)
        await session.commit()
    response.delete_cookie(settings.refresh_cookie_name, path="/api/auth")
    response.status_code = 204
    return response


@router.get("/api/admin/users", response_model=Envelope[list[UserRead]], tags=["admin-users"])
async def list_users(
    _: AdminPrincipal,
    session: DbSession,
    role: UserRole | None = None,
    status_: UserStatus | None = Query(None, alias="status"),
    include_deleted: bool = False,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> Envelope[list[UserRead]]:
    filters = []
    if not include_deleted:
        filters.append(UserAccount.deleted_at.is_(None))
    if role:
        filters.append(UserAccount.role == role)
    if status_:
        filters.append(UserAccount.status == status_)
    total = await session.scalar(select(func.count()).select_from(UserAccount).where(*filters))
    users = (
        await session.scalars(
            select(UserAccount)
            .where(*filters)
            .order_by(UserAccount.username)
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Envelope(
        data=[UserRead.model_validate(user) for user in users],
        meta=PageMeta(limit=limit, offset=offset, total=total or 0),
    )


@router.post(
    "/api/admin/users", status_code=201, response_model=Envelope[UserRead], tags=["admin-users"]
)
async def create_user(
    body: UserCreate, _: AdminPrincipal, session: DbSession
) -> Envelope[UserRead]:
    user = UserAccount(
        username=normalize_username(body.username),
        display_name=body.display_name,
        password_hash=hash_password(body.password),
        role=body.role,
        status=UserStatus.ACTIVE,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail="Username already exists") from exc
    await session.refresh(user)
    return Envelope(data=UserRead.model_validate(user))


@router.get("/api/admin/users/{user_id}", response_model=Envelope[UserRead], tags=["admin-users"])
async def get_user(user_id: uuid.UUID, _: AdminPrincipal, session: DbSession) -> Envelope[UserRead]:
    user = await session.get(UserAccount, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return Envelope(data=UserRead.model_validate(user))


async def _ensure_admin_survives(
    session: AsyncSession, user: UserAccount, role: UserRole, status: UserStatus
) -> None:
    if user.role != UserRole.ADMIN or user.status != UserStatus.ACTIVE or user.deleted_at:
        return
    if role == UserRole.ADMIN and status == UserStatus.ACTIVE:
        return
    active_admins = await session.scalar(
        select(func.count())
        .select_from(UserAccount)
        .where(
            UserAccount.role == UserRole.ADMIN,
            UserAccount.status == UserStatus.ACTIVE,
            UserAccount.deleted_at.is_(None),
        )
    )
    if (active_admins or 0) <= 1:
        raise HTTPException(status_code=409, detail="The last active admin cannot be changed")


@router.patch("/api/admin/users/{user_id}", response_model=Envelope[UserRead], tags=["admin-users"])
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    _: AdminPrincipal,
    session: DbSession,
) -> Envelope[UserRead]:
    user = await session.get(UserAccount, user_id, with_for_update=True)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=404, detail="User not found")
    next_role = body.role or user.role
    next_status = body.status or user.status
    await _ensure_admin_survives(session, user, next_role, next_status)
    if "display_name" in body.model_fields_set:
        user.display_name = body.display_name
    if body.role is not None:
        user.role = body.role
    if body.status is not None:
        user.status = body.status
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    user.updated_at = datetime.now(UTC)
    if body.password is not None or body.status == UserStatus.DISABLED or body.role is not None:
        await revoke_user_sessions(session, user.id)
    await session.commit()
    await session.refresh(user)
    return Envelope(data=UserRead.model_validate(user))


@router.delete("/api/admin/users/{user_id}", status_code=204, tags=["admin-users"])
async def delete_user(
    user_id: uuid.UUID,
    principal: AdminPrincipal,
    response: Response,
    session: DbSession,
) -> Response:
    if user_id == principal.user_id:
        raise HTTPException(status_code=409, detail="Admins cannot delete their own account")
    user = await session.get(UserAccount, user_id, with_for_update=True)
    if not user or user.deleted_at is not None:
        raise HTTPException(status_code=404, detail="User not found")
    await _ensure_admin_survives(session, user, user.role, UserStatus.DISABLED)
    user.status = UserStatus.DISABLED
    user.deleted_at = datetime.now(UTC)
    user.updated_at = user.deleted_at
    await revoke_user_sessions(session, user.id)
    await session.commit()
    response.status_code = 204
    return response
