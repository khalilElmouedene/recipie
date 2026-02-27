from __future__ import annotations
import uuid
from functools import wraps
from typing import Annotated

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import get_db
from .db_models import User, UserRole, ProjectMember, ProjectMemberRole

security = HTTPBearer(auto_error=False)


async def _decode_token(token: str, db: AsyncSession) -> User:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
    token: str | None = Query(default=None),
) -> User:
    # Accept token from header OR ?token= query param (for file downloads via window.open)
    raw = None
    if credentials:
        raw = credentials.credentials
    elif token:
        raw = token
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return await _decode_token(raw, db)


def require_owner(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != UserRole.owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner access required")
    return user


async def check_project_access(
    project_id: uuid.UUID,
    user: User,
    db: AsyncSession,
    *,
    require_roles: list[ProjectMemberRole] | None = None,
) -> ProjectMemberRole | None:
    """Return the user's project-level role, or None for owners (who have full access).
    Raises 403 if the user has no access or doesn't meet required_roles."""
    if user.role == UserRole.owner:
        return None

    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")

    if require_roles and membership.role not in require_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient project role")

    return membership.role
