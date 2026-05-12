from __future__ import annotations
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import SpySheet
from ..dependencies import get_current_user, check_project_access
from ..db_models import User
from ..services.auto_spy_scraper import (
    _append_rows_to_tab,
    _domain_from_url,
    _filter_food_rows,
    _get_project_openai_key,
    _load_workbook,
    _make_sheet_tab,
    _normalize_url,
    _save_workbook,
    scrape_source_rows,
)

router = APIRouter()


class SpySheetPayload(BaseModel):
    data: str | None = None


class SpySheetOut(BaseModel):
    project_id: str
    data: str | None
    updated_at: str | None


class SpySheetScrapePayload(BaseModel):
    url: str


class SpySheetScrapeOut(SpySheetOut):
    site_name: str
    rows_added: int


async def _get_or_create_spy_sheet(project_id: uuid.UUID, db: AsyncSession) -> SpySheet:
    result = await db.execute(
        select(SpySheet).where(SpySheet.project_id == project_id)
    )
    sheet = result.scalar_one_or_none()
    if sheet is None:
        sheet = SpySheet(
            project_id=project_id,
            data=None,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(sheet)
        await db.flush()
    return sheet


def _load_spy_workbook(raw: str | None) -> dict:
    workbook = _load_workbook(raw)
    if isinstance(workbook, dict) and isinstance(workbook.get("sheets"), list):
        if workbook["sheets"] and not workbook.get("activeId"):
            workbook["activeId"] = workbook["sheets"][0].get("id", "")
        return workbook
    if isinstance(workbook, dict) and "cells" in workbook:
        tab_id = str(uuid.uuid4())
        return {
            "sheets": [{"id": tab_id, "name": "Sheet1", "data": workbook}],
            "activeId": tab_id,
        }
    return {"sheets": [], "activeId": ""}


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


@router.post("/api/projects/{project_id}/spy-sheet/scrape", response_model=SpySheetScrapeOut)
async def scrape_into_spy_sheet(
    project_id: uuid.UUID,
    body: SpySheetScrapePayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)

    normalized = _normalize_url(body.url)
    site_name = _domain_from_url(normalized)
    one_week_ago = datetime.now(timezone.utc) - timedelta(weeks=1)

    rows = await scrape_source_rows(normalized, one_week_ago)
    if rows:
        openai_key = await _get_project_openai_key(project_id, current_user.id)
        if openai_key:
            rows = await _filter_food_rows(rows, openai_key)

    sheet = await _get_or_create_spy_sheet(project_id, db)
    workbook = _load_spy_workbook(sheet.data)
    tab_id = str(uuid.uuid4())
    workbook["sheets"].append(_make_sheet_tab(tab_id, site_name))
    workbook["activeId"] = tab_id
    rows_added = _append_rows_to_tab(workbook, tab_id, rows)

    now = datetime.now(timezone.utc)
    sheet.data = _save_workbook(workbook)
    sheet.updated_at = now
    await db.commit()
    await db.refresh(sheet)

    return SpySheetScrapeOut(
        project_id=str(project_id),
        data=sheet.data,
        updated_at=sheet.updated_at.isoformat() if sheet.updated_at else None,
        site_name=site_name,
        rows_added=rows_added,
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
