from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import AutoSpySheet, AutoSpySource, User
from ..dependencies import get_current_user, check_project_access
from ..services.auto_spy_scraper import (
    _load_workbook,
    _make_sheet_tab,
    _save_workbook,
    scan_source,
)

router = APIRouter()


# ── Pydantic models ────────────────────────────────────────────────────────────

class AutoSpySheetOut(BaseModel):
    project_id: str
    data: str | None
    updated_at: str | None


class AutoSpySheetPayload(BaseModel):
    data: str | None = None


class AutoSpySourceOut(BaseModel):
    id: str
    project_id: str
    created_by_user_id: str | None
    url: str
    site_name: str
    sheet_tab_id: str
    last_scanned_at: str | None
    next_scan_at: str | None
    created_at: str


class AddSourcePayload(BaseModel):
    url: str


# ── Helpers ────────────────────────────────────────────────────────────────────

def _normalize_url(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    return raw


def _domain_from_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc or parsed.path
    return host.removeprefix("www.")


def _fmt(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _source_out(s: AutoSpySource) -> AutoSpySourceOut:
    return AutoSpySourceOut(
        id=str(s.id),
        project_id=str(s.project_id),
        created_by_user_id=str(s.created_by_user_id) if s.created_by_user_id else None,
        url=s.url,
        site_name=s.site_name,
        sheet_tab_id=s.sheet_tab_id,
        last_scanned_at=_fmt(s.last_scanned_at),
        next_scan_at=_fmt(s.next_scan_at),
        created_at=_fmt(s.created_at),
    )


async def _get_or_create_sheet(project_id: uuid.UUID, db: AsyncSession) -> AutoSpySheet:
    result = await db.execute(select(AutoSpySheet).where(AutoSpySheet.project_id == project_id))
    sheet = result.scalar_one_or_none()
    if sheet is None:
        sheet = AutoSpySheet(
            project_id=project_id,
            data=None,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(sheet)
        await db.flush()
    return sheet


# ── Sheet endpoints ────────────────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/auto-spy/sheet", response_model=AutoSpySheetOut)
async def get_auto_spy_sheet(
    project_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)
    result = await db.execute(select(AutoSpySheet).where(AutoSpySheet.project_id == project_id))
    sheet = result.scalar_one_or_none()
    if sheet is None:
        return AutoSpySheetOut(project_id=str(project_id), data=None, updated_at=None)
    return AutoSpySheetOut(
        project_id=str(project_id),
        data=sheet.data,
        updated_at=_fmt(sheet.updated_at),
    )


@router.put("/api/projects/{project_id}/auto-spy/sheet", response_model=AutoSpySheetOut)
async def save_auto_spy_sheet(
    project_id: uuid.UUID,
    body: AutoSpySheetPayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)
    sheet = await _get_or_create_sheet(project_id, db)
    now = datetime.now(timezone.utc)
    sheet.data = body.data
    sheet.updated_at = now
    await db.commit()
    await db.refresh(sheet)
    return AutoSpySheetOut(
        project_id=str(project_id),
        data=sheet.data,
        updated_at=_fmt(sheet.updated_at),
    )


# ── Source endpoints ───────────────────────────────────────────────────────────

@router.get("/api/projects/{project_id}/auto-spy/sources", response_model=list[AutoSpySourceOut])
async def list_auto_spy_sources(
    project_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)
    result = await db.execute(
        select(AutoSpySource)
        .where(AutoSpySource.project_id == project_id)
        .order_by(AutoSpySource.created_at.asc())
    )
    return [_source_out(s) for s in result.scalars().all()]


@router.post("/api/projects/{project_id}/auto-spy/sources", response_model=AutoSpySourceOut)
async def add_auto_spy_source(
    project_id: uuid.UUID,
    body: AddSourcePayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)

    normalized = _normalize_url(body.url)
    site_name = _domain_from_url(normalized)
    tab_id = str(uuid.uuid4())

    # Add tab to workbook
    sheet = await _get_or_create_sheet(project_id, db)
    workbook = _load_workbook(sheet.data)
    new_tab = _make_sheet_tab(tab_id, site_name)
    workbook["sheets"].append(new_tab)
    if not workbook["activeId"]:
        workbook["activeId"] = tab_id
    sheet.data = _save_workbook(workbook)
    sheet.updated_at = datetime.now(timezone.utc)

    # Create source record — next_scan_at = now so first scan runs immediately
    now = datetime.now(timezone.utc)
    source = AutoSpySource(
        project_id=project_id,
        created_by_user_id=current_user.id,
        url=normalized,
        site_name=site_name,
        sheet_tab_id=tab_id,
        next_scan_at=now,
    )
    db.add(source)
    await db.commit()
    await db.refresh(source)

    # Kick off an immediate background scan
    source_id = source.id
    asyncio.create_task(scan_source(source_id))

    return _source_out(source)


@router.delete("/api/projects/{project_id}/auto-spy/sources/{source_id}", status_code=204)
async def delete_auto_spy_source(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)

    result = await db.execute(
        select(AutoSpySource).where(
            AutoSpySource.id == source_id,
            AutoSpySource.project_id == project_id,
        )
    )
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")

    tab_id = source.sheet_tab_id

    # Remove tab from workbook
    sheet_result = await db.execute(select(AutoSpySheet).where(AutoSpySheet.project_id == project_id))
    sheet = sheet_result.scalar_one_or_none()
    if sheet and sheet.data:
        workbook = _load_workbook(sheet.data)
        workbook["sheets"] = [s for s in workbook["sheets"] if s["id"] != tab_id]
        if workbook["activeId"] == tab_id:
            workbook["activeId"] = workbook["sheets"][0]["id"] if workbook["sheets"] else ""
        sheet.data = _save_workbook(workbook)
        sheet.updated_at = datetime.now(timezone.utc)

    await db.delete(source)
    await db.commit()


@router.post("/api/projects/{project_id}/auto-spy/sources/{source_id}/scan", status_code=202)
async def trigger_scan(
    project_id: uuid.UUID,
    source_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)

    result = await db.execute(
        select(AutoSpySource).where(
            AutoSpySource.id == source_id,
            AutoSpySource.project_id == project_id,
        )
    )
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=404, detail="Source not found")

    asyncio.create_task(scan_source(source_id))
    return {"status": "scan triggered"}
