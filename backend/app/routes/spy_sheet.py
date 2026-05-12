from __future__ import annotations
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import SessionLocal, get_db
from ..db_models import SpySheet, SpySheetSource, User
from ..dependencies import get_current_user, check_project_access
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


class SpySheetSourcePayload(BaseModel):
    url: str


class SpySheetSourceOut(BaseModel):
    id: str
    project_id: str
    created_by_user_id: str | None
    url: str
    site_name: str
    sheet_tab_id: str
    last_scanned_at: str | None
    created_at: str | None


def _source_out(source: SpySheetSource) -> SpySheetSourceOut:
    return SpySheetSourceOut(
        id=str(source.id),
        project_id=str(source.project_id),
        created_by_user_id=str(source.created_by_user_id) if source.created_by_user_id else None,
        url=source.url,
        site_name=source.site_name,
        sheet_tab_id=source.sheet_tab_id,
        last_scanned_at=source.last_scanned_at.isoformat() if source.last_scanned_at else None,
        created_at=source.created_at.isoformat() if source.created_at else None,
    )


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


def _ensure_source_tab(workbook: dict, source: SpySheetSource) -> None:
    sheets = workbook.setdefault("sheets", [])
    if not any(sheet.get("id") == source.sheet_tab_id for sheet in sheets):
        sheets.append(_make_sheet_tab(source.sheet_tab_id, source.site_name))
    if sheets and not workbook.get("activeId"):
        workbook["activeId"] = sheets[0].get("id", "")


async def _scan_spy_sheet_source(source_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        result = await db.execute(select(SpySheetSource).where(SpySheetSource.id == source_id))
        source = result.scalar_one_or_none()
        if source is None:
            return

        one_week_ago = datetime.now(timezone.utc) - timedelta(weeks=1)
        rows = await scrape_source_rows(source.url, one_week_ago)
        if rows:
            openai_key = await _get_project_openai_key(source.project_id, source.created_by_user_id)
            if openai_key:
                rows = await _filter_food_rows(rows, openai_key)

        sheet = await _get_or_create_spy_sheet(source.project_id, db)
        workbook = _load_spy_workbook(sheet.data)
        _ensure_source_tab(workbook, source)
        _append_rows_to_tab(workbook, source.sheet_tab_id, rows)

        now = datetime.now(timezone.utc)
        sheet.data = _save_workbook(workbook)
        sheet.updated_at = now
        source.last_scanned_at = now
        await db.commit()


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


@router.get("/api/projects/{project_id}/spy-sheet/sources", response_model=list[SpySheetSourceOut])
async def list_spy_sheet_sources(
    project_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)
    result = await db.execute(
        select(SpySheetSource)
        .where(SpySheetSource.project_id == project_id)
        .order_by(SpySheetSource.created_at.asc())
    )
    return [_source_out(source) for source in result.scalars().all()]


@router.post("/api/projects/{project_id}/spy-sheet/sources", response_model=SpySheetSourceOut)
async def add_spy_sheet_source(
    project_id: uuid.UUID,
    body: SpySheetSourcePayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)

    normalized = _normalize_url(body.url)
    site_name = _domain_from_url(normalized)
    tab_id = str(uuid.uuid4())

    sheet = await _get_or_create_spy_sheet(project_id, db)
    workbook = _load_spy_workbook(sheet.data)

    source = SpySheetSource(
        project_id=project_id,
        created_by_user_id=current_user.id,
        url=normalized,
        site_name=site_name,
        sheet_tab_id=tab_id,
        created_at=datetime.now(timezone.utc),
    )
    workbook["sheets"].append(_make_sheet_tab(tab_id, site_name))
    if not workbook.get("activeId"):
        workbook["activeId"] = tab_id
    sheet.data = _save_workbook(workbook)
    sheet.updated_at = datetime.now(timezone.utc)

    db.add(source)
    await db.commit()
    await db.refresh(source)

    source_id = source.id
    asyncio.create_task(_scan_spy_sheet_source(source_id))
    return _source_out(source)


@router.delete("/api/projects/{project_id}/spy-sheet/sources/{source_id}", status_code=204)
async def delete_spy_sheet_source(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)
    result = await db.execute(
        select(SpySheetSource).where(
            SpySheetSource.id == source_id,
            SpySheetSource.project_id == project_id,
        )
    )
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")

    tab_id = source.sheet_tab_id
    sheet_result = await db.execute(select(SpySheet).where(SpySheet.project_id == project_id))
    sheet = sheet_result.scalar_one_or_none()
    if sheet and sheet.data:
        workbook = _load_spy_workbook(sheet.data)
        workbook["sheets"] = [s for s in workbook.get("sheets", []) if s.get("id") != tab_id]
        if workbook.get("activeId") == tab_id:
            workbook["activeId"] = workbook["sheets"][0]["id"] if workbook["sheets"] else ""
        sheet.data = _save_workbook(workbook)
        sheet.updated_at = datetime.now(timezone.utc)

    await db.delete(source)
    await db.commit()


@router.post("/api/projects/{project_id}/spy-sheet/sources/{source_id}/scan", status_code=202)
async def trigger_spy_sheet_source_scan(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)
    result = await db.execute(
        select(SpySheetSource).where(
            SpySheetSource.id == source_id,
            SpySheetSource.project_id == project_id,
        )
    )
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")

    asyncio.create_task(_scan_spy_sheet_source(source.id))
    return {"status": "scan triggered"}


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
