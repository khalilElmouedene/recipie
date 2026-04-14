from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import AuditLog, User, UserRole
from ..dependencies import get_current_user
from ..models import AuditLogListOut, AuditLogOut

router = APIRouter(prefix="/api/audit-logs", tags=["audit-logs"])


@router.get("", response_model=AuditLogListOut)
async def list_audit_logs(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None),
    table_name: str | None = Query(default=None),
    actor_user_id: uuid.UUID | None = Query(default=None),
    entity_pk: str | None = Query(default=None),
    from_at: datetime | None = Query(default=None),
    to_at: datetime | None = Query(default=None),
    include_system: bool = Query(default=False),
) -> AuditLogListOut:
    filters = []

    if user.role == UserRole.owner:
        managed_users_subquery = select(User.id).where(
            or_(User.id == user.id, User.created_by_owner_id == user.id)
        )
        owner_visibility = AuditLog.actor_user_id.in_(managed_users_subquery)
        if include_system:
            owner_visibility = or_(owner_visibility, AuditLog.actor_user_id.is_(None))
        filters.append(owner_visibility)
    else:
        filters.append(AuditLog.actor_user_id == user.id)

    if action:
        filters.append(AuditLog.action == action.lower())
    if table_name:
        filters.append(AuditLog.table_name == table_name)
    if actor_user_id:
        filters.append(AuditLog.actor_user_id == actor_user_id)
    if entity_pk:
        filters.append(AuditLog.entity_pk == entity_pk)
    if from_at:
        filters.append(AuditLog.occurred_at >= from_at)
    if to_at:
        filters.append(AuditLog.occurred_at <= to_at)

    where_clause = and_(*filters) if filters else None

    count_stmt = select(func.count()).select_from(AuditLog)
    if where_clause is not None:
        count_stmt = count_stmt.where(where_clause)
    total = (await db.scalar(count_stmt)) or 0

    query = select(AuditLog).order_by(desc(AuditLog.occurred_at)).offset(offset).limit(limit)
    if where_clause is not None:
        query = query.where(where_clause)
    rows = (await db.execute(query)).scalars().all()

    return AuditLogListOut(
        total=total,
        items=[AuditLogOut.model_validate(r) for r in rows],
    )
