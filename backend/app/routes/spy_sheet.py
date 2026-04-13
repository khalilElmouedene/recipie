from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import SpySheet
from ..dependencies import get_current_user, check_project_access
from ..db_models import User

router = APIRouter()


class SpySheetPayload(BaseModel):
    data: str | None = None


class SpySheetOut(BaseModel):
    project_id: str
    data: str | None
    updated_at: str | None


@router.get("/api/projects/{project_id}/spy-sheet", response_model=SpySheetOut)
async def get_spy_sheet(
    project_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)

    result = await db.execute(
        select(SpySheet).where(SpySheet.project_id == project_id)
    )
    sheet = result.scalar_one_or_none()

    if sheet is None:
        return SpySheetOut(
            project_id=str(project_id),
            data=None,
            updated_at=None,
        )

    return SpySheetOut(
        project_id=str(project_id),
        data=sheet.data,
        updated_at=sheet.updated_at.isoformat() if sheet.updated_at else None,
    )


@router.put("/api/projects/{project_id}/spy-sheet", response_model=SpySheetOut)
async def save_spy_sheet(
    project_id: uuid.UUID,
    body: SpySheetPayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)

    result = await db.execute(
        select(SpySheet).where(SpySheet.project_id == project_id)
    )
    sheet = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)

    if sheet is None:
        sheet = SpySheet(
            project_id=project_id,
            data=body.data,
            updated_at=now,
        )
        db.add(sheet)
    else:
        sheet.data = body.data
        sheet.updated_at = now

    await db.commit()
    await db.refresh(sheet)

    return SpySheetOut(
        project_id=str(project_id),
        data=sheet.data,
        updated_at=sheet.updated_at.isoformat() if sheet.updated_at else None,
    )
