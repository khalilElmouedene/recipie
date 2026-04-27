from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import AutoSpySheet, AutoSpySource, Job, JobStatus, JobType, Site, User
from ..dependencies import get_current_user, check_project_access
from ..models import SharedRecipeInput
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


# ── Auto-spy last-published date ───────────────────────────────────────────────

_WP_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; AutoSpy/1.0)"}
_WP_TIMEOUT = httpx.Timeout(15.0, connect=5.0)


@router.get("/api/projects/{project_id}/auto-spy/last-published")
async def get_last_published(
    project_id: uuid.UUID,
    site_id: uuid.UUID = Query(..., description="Site ID"),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    await check_project_access(project_id, current_user, db)

    result = await db.execute(select(Site).where(Site.id == site_id, Site.project_id == project_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    base = site.wp_url.strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        base = "https://" + base

    auth: tuple[str, str] | None = None
    try:
        from ..site_credentials import get_random_wp_credentials
        auth = get_random_wp_credentials(site)
    except Exception:
        pass

    last_date: str | None = None
    try:
        async with httpx.AsyncClient(headers=_WP_HEADERS, timeout=_WP_TIMEOUT, follow_redirects=True) as client:
            # Authenticated request: fetch both published and scheduled (future) posts
            params = {"per_page": 1, "orderby": "date", "order": "desc", "_fields": "date", "status": "publish,future"}
            kwargs: dict = {"params": params}
            if auth:
                kwargs["auth"] = auth
            resp = await client.get(f"{base}/wp-json/wp/v2/posts", **kwargs)
            if resp.status_code == 200:
                posts = resp.json()
                if posts and isinstance(posts, list) and posts[0].get("date"):
                    last_date = posts[0]["date"]
            elif auth and resp.status_code in (401, 403):
                # Auth rejected — fall back to unauthenticated published-only
                resp2 = await client.get(
                    f"{base}/wp-json/wp/v2/posts",
                    params={"per_page": 1, "orderby": "date", "order": "desc", "_fields": "date"},
                )
                if resp2.status_code == 200:
                    posts = resp2.json()
                    if posts and isinstance(posts, list) and posts[0].get("date"):
                        last_date = posts[0]["date"]
    except Exception:
        pass

    return {"last_published_at": last_date}


# ── Auto-spy generate job ──────────────────────────────────────────────────────

class SiteScheduleInput(BaseModel):
    site_id: str
    publish_start_at: str   # ISO-8601 datetime
    interval_minutes: int = 240


class AutoSpyGeneratePayload(BaseModel):
    shared_recipes: list[SharedRecipeInput]
    site_schedules: list[SiteScheduleInput]


from ..models import JobOut  # noqa: E402 — avoid circular at module level


@router.post("/api/projects/{project_id}/auto-spy/generate", response_model=JobOut, status_code=201)
async def start_auto_spy_generate(
    project_id: uuid.UUID,
    body: AutoSpyGeneratePayload,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, current_user, db)

    if not body.shared_recipes:
        raise HTTPException(status_code=400, detail="shared_recipes is required")
    if not body.site_schedules:
        raise HTTPException(status_code=400, detail="site_schedules is required")

    # Parse and validate per-site schedules
    parsed_schedules: list[dict] = []
    for ss in body.site_schedules:
        try:
            dt = datetime.fromisoformat(ss.publish_start_at.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid publish_start_at for site {ss.site_id}")
        parsed_schedules.append({
            "site_id": uuid.UUID(ss.site_id),
            "publish_start_at": dt,
            "interval_minutes": max(1, ss.interval_minutes),
        })

    # Load sites — only include sites that have a schedule entry
    scheduled_site_ids = {ps["site_id"] for ps in parsed_schedules}
    site_rows = await db.execute(
        select(Site).where(
            Site.project_id == project_id,
            Site.id.in_(scheduled_site_ids),
        ).order_by(Site.created_at.asc())
    )
    sites = site_rows.scalars().all()
    if not sites:
        raise HTTPException(status_code=400, detail="No matching sites found for the provided schedules")

    # Load credentials and prompts (reuse the loader from job_manager)
    from ..services.credentials_loader import load_credentials_for_job
    from ..services.prompts import DEFAULT_PROMPTS
    from ..db_models import Project, Prompt

    credentials = await load_credentials_for_job(db, project_id, current_user.id)
    if not credentials.get("openai"):
        raise HTTPException(
            status_code=400,
            detail="OpenAI API key not found. Go to Settings → API Keys, paste your OpenAI key, and save.",
        )

    prompts: dict[str, str] = {}
    prj_row = await db.execute(select(Project).where(Project.id == project_id))
    prj = prj_row.scalar_one_or_none()
    if prj:
        fallback = await db.execute(
            select(Prompt).where(Prompt.owner_id == prj.owner_id, Prompt.project_id.is_(None))
        )
        for p in fallback.scalars().all():
            prompts[p.key] = p.value
        project_prompts = await db.execute(
            select(Prompt).where(Prompt.owner_id == prj.owner_id, Prompt.project_id == project_id)
        )
        for p in project_prompts.scalars().all():
            prompts[p.key] = p.value

    # Create job record
    db_job = Job(
        project_id=project_id,
        created_by=current_user.id,
        job_type=JobType.auto_spy_generate,
        status=JobStatus.pending,
    )
    db.add(db_job)
    await db.commit()
    await db.refresh(db_job)

    # Start the job (non-blocking)
    from ..services.auto_spy_job_runner import start_auto_spy_generate_job
    from ..workers.job_manager import job_manager

    main_loop = asyncio.get_running_loop()
    asyncio.create_task(
        start_auto_spy_generate_job(
            db_job=db_job,
            shared_recipes=body.shared_recipes,
            site_schedules=parsed_schedules,
            credentials=credentials,
            prompts=prompts,
            sites=list(sites),
            running_jobs=job_manager._running,
            main_loop=main_loop,
        )
    )

    # Refresh to get updated status
    row = await db.execute(select(Job).where(Job.id == db_job.id))
    return row.scalar_one()
