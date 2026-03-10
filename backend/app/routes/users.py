from __future__ import annotations
import hashlib
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete as sql_delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import hash_password
from ..config import settings
from ..database import get_db
from ..db_models import User, UserRole, PasswordSetupToken
from ..dependencies import require_owner
from ..models import UserOut, UserCreate, UserRoleUpdate
from ..services.email_service import send_welcome_email

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
async def list_users(
    _owner: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(User)
        .where(User.created_by_owner_id == _owner.id)
        .order_by(User.created_at.desc())
    )
    return result.scalars().all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    _owner: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already in use")

    if body.role not in ("owner", "admin", "member"):
        raise HTTPException(status_code=400, detail="Invalid role")

    user = User(
        email=body.email,
        password_hash=None,
        full_name=body.full_name,
        role=UserRole(body.role),
        created_by_owner_id=_owner.id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Generate invite token
    raw_token = secrets.token_hex(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
    setup_token = PasswordSetupToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
    )
    db.add(setup_token)
    await db.commit()

    setup_link = f"{settings.frontend_url}/setup-password?token={raw_token}"
    try:
        await send_welcome_email(user.email, user.full_name, setup_link)
    except Exception as exc:
        print(f"[email] Failed to send welcome email: {exc}")

    row = await db.execute(select(User).where(User.id == user.id))
    return UserOut.from_user(row.scalar_one())


@router.patch("/{user_id}", response_model=UserOut)
async def update_user_role(
    user_id: uuid.UUID,
    body: UserRoleUpdate,
    _owner: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or user.created_by_owner_id != _owner.id:
        raise HTTPException(status_code=404, detail="User not found")

    if body.role not in ("owner", "admin", "member"):
        raise HTTPException(status_code=400, detail="Invalid role")

    user.role = UserRole(body.role)
    await db.commit()
    row = await db.execute(select(User).where(User.id == user_id))
    return row.scalar_one()


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    owner: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if user_id == owner.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if not target or target.created_by_owner_id != owner.id:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent deleting the last owner — the system must always have one
    if target.role == UserRole.owner:
        owner_count = await db.scalar(
            select(func.count()).select_from(User).where(User.role == UserRole.owner)
        )
        if owner_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last owner of the system")

    await db.execute(sql_delete(User).where(User.id == user_id))
    await db.commit()
