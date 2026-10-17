from __future__ import annotations

import hashlib
import re
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models.entities import RefreshSession, UserAccount, UserRole, UserStatus

password_hasher = PasswordHash.recommended()


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    return password_hasher.verify(password, encoded)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _encode_token(
    user: UserAccount,
    settings: Settings,
    token_type: str,
    expires_at: datetime,
    token_id: uuid.UUID,
) -> str:
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "sub": str(user.id),
            "username": user.username,
            "role": user.role.value,
            "type": token_type,
            "jti": str(token_id),
            "iat": now,
            "exp": expires_at,
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_token(token: str, settings: Settings, expected_type: str) -> dict:
    claims = jwt.decode(
        token,
        settings.jwt_secret_key,
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "type", "jti", "iat", "exp"]},
    )
    if claims.get("type") != expected_type:
        raise jwt.InvalidTokenError("Unexpected token type")
    return claims


async def issue_token_pair(
    session: AsyncSession, user: UserAccount, settings: Settings
) -> tuple[str, str, int, RefreshSession]:
    now = datetime.now(UTC)
    access_id = uuid.uuid4()
    refresh_id = uuid.uuid4()
    access_expiry = now + timedelta(minutes=settings.access_token_minutes)
    refresh_expiry = now + timedelta(days=settings.refresh_token_days)
    access_token = _encode_token(user, settings, "access", access_expiry, access_id)
    refresh_token = _encode_token(user, settings, "refresh", refresh_expiry, refresh_id)
    refresh_session = RefreshSession(
        id=refresh_id,
        user_id=user.id,
        token_hash=_token_hash(refresh_token),
        expires_at=refresh_expiry,
    )
    session.add(refresh_session)
    await session.flush()
    return access_token, refresh_token, settings.access_token_minutes * 60, refresh_session


async def rotate_refresh_token(
    session: AsyncSession, token: str, settings: Settings
) -> tuple[UserAccount, str, str, int]:
    claims = decode_token(token, settings, "refresh")
    token_id = uuid.UUID(claims["jti"])
    stored = await session.scalar(
        select(RefreshSession).where(RefreshSession.id == token_id).with_for_update()
    )
    now = datetime.now(UTC)
    stored_expiry = stored.expires_at if stored else None
    if stored_expiry is not None and stored_expiry.tzinfo is None:
        stored_expiry = stored_expiry.replace(tzinfo=UTC)
    if not stored or stored.token_hash != _token_hash(token) or stored_expiry <= now:
        raise jwt.InvalidTokenError("Unknown or expired refresh session")
    if stored.revoked_at is not None:
        await revoke_user_sessions(session, stored.user_id)
        await session.commit()
        raise jwt.InvalidTokenError("Refresh token reuse detected")
    user = await session.get(UserAccount, stored.user_id)
    if not user or user.deleted_at is not None or user.status != UserStatus.ACTIVE:
        raise jwt.InvalidTokenError("Account unavailable")
    stored.revoked_at = now
    access, refresh, expires_in, replacement = await issue_token_pair(session, user, settings)
    stored.replaced_by = replacement.id
    return user, access, refresh, expires_in


async def revoke_refresh_token(session: AsyncSession, token: str, settings: Settings) -> None:
    try:
        claims = decode_token(token, settings, "refresh")
        token_id = uuid.UUID(claims["jti"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return
    stored = await session.get(RefreshSession, token_id, with_for_update=True)
    if stored and stored.revoked_at is None:
        stored.revoked_at = datetime.now(UTC)


async def revoke_user_sessions(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(
        update(RefreshSession)
        .where(RefreshSession.user_id == user_id, RefreshSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )


async def initialize_admin(session: AsyncSession, settings: Settings) -> UserAccount:
    username_value = settings.initial_admin_username
    password_secret = settings.initial_admin_password
    if not username_value or password_secret is None:
        raise ValueError("INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD are required")
    username = normalize_username(username_value)
    password = password_secret.get_secret_value()
    if not re.fullmatch(r"[a-z0-9_.-]{1,64}", username):
        raise ValueError("INITIAL_ADMIN_USERNAME has an invalid format")
    if not 8 <= len(password) <= 256:
        raise ValueError("INITIAL_ADMIN_PASSWORD must contain 8 to 256 characters")
    if session.bind and session.bind.dialect.name == "postgresql":
        await session.execute(text("SELECT pg_advisory_xact_lock(73011820261017)"))
    existing = await session.scalar(select(func.count()).select_from(UserAccount))
    if existing:
        raise ValueError("Initial admin can only be created when no user accounts exist")
    user = UserAccount(
        username=username,
        display_name=None,
        password_hash=hash_password(password),
        role=UserRole.ADMIN,
        status=UserStatus.ACTIVE,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user
