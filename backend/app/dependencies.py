from __future__ import annotations
import re
import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .database import get_db
from .db_models import User, UserRole, ProjectMember, ProjectMemberRole

security = HTTPBearer(auto_error=False)

# JWT in query string only for export URLs opened via window.open (cannot set Authorization header).
_QUERY_TOKEN_PATH = re.compile(
    r"^/api/sites/[0-9a-fA-F-]{36}/recipes/export/?$"
    r"|^/api/sites/[0-9a-fA-F-]{36}/export/excel/?$"
    r"|^/api/projects/[0-9a-fA-F-]{36}/export/excel/?$"
)


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
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
    token: str | None = Query(default=None),
) -> User:
    raw = None
    if credentials:
        raw = credentials.credentials
    elif token and _QUERY_TOKEN_PATH.match(request.url.path):
        raw = token
    elif token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Use Authorization header; query token is only allowed for export endpoints",
        )
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
    """Return the user's project-level role. All users (including owners) must be
    a member of the project or its owner_id to access it."""
    from .db_models import Project

    # Allow if the user is the project owner_id
    project_row = await db.execute(select(Project).where(Project.id == project_id))
    project = project_row.scalar_one_or_none()
    if project and project.owner_id == user.id:
        # Project creator always has admin access
        if require_roles and ProjectMemberRole.admin not in require_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient project role")
        return ProjectMemberRole.admin

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
