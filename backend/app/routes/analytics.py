from __future__ import annotations
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, func, case, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import (
    User, Project, ProjectMember, Site, Recipe, RecipeStatus, Job, JobStatus,
)
from ..dependencies import get_current_user

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class SiteAnalytics(BaseModel):
    id: str
    domain: str
    total: int
    published: int
    generated: int
    pending: int
    failed: int
    last_published_at: datetime | None
    last_title: str | None


class ProjectAnalytics(BaseModel):
    id: str
    name: str
    site_count: int
    total: int
    published: int
    generated: int
    pending: int
    failed: int
    last_published_at: datetime | None
    sites: list[SiteAnalytics]


class RecentJob(BaseModel):
    id: str
    job_type: str
    status: str
    project_name: str
    created_at: datetime
    finished_at: datetime | None
    total_rows: int | None
    current_row: int | None


class LastPublished(BaseModel):
    title: str
    site_domain: str
    wp_permalink: str | None
    created_at: datetime


class MonthStat(BaseModel):
    month: str
    generated: int
    published: int


class OwnerAnalytics(BaseModel):
    total_projects: int
    total_sites: int
    total_recipes: int
    total_published: int
    total_generated: int
    total_pending: int
    total_failed: int
    total_jobs: int
    total_jobs_completed: int
    total_jobs_failed: int
    success_rate: float
    last_published: LastPublished | None
    recent_jobs: list[RecentJob]
    projects: list[ProjectAnalytics]
    monthly: list[MonthStat]


_EMPTY = OwnerAnalytics(
    total_projects=0, total_sites=0, total_recipes=0,
    total_published=0, total_generated=0, total_pending=0, total_failed=0,
    total_jobs=0, total_jobs_completed=0, total_jobs_failed=0,
    success_rate=0.0, last_published=None, recent_jobs=[], projects=[], monthly=[],
)


@router.get("", response_model=OwnerAnalytics)
async def get_analytics(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    projects_q = await db.execute(
        select(Project)
        .where(
            (Project.owner_id == user.id) |
            (Project.id.in_(
                select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
            ))
        )
        .order_by(Project.created_at.desc())
    )
    projects = projects_q.scalars().all()
    if not projects:
        return _EMPTY

    project_ids = [p.id for p in projects]
    project_name_map = {p.id: p.name for p in projects}

    # ── Global recipe counts by status ───────────────────────────────────────
    rs_q = await db.execute(
        select(Recipe.status, func.count().label("cnt"))
        .join(Site, Recipe.site_id == Site.id)
        .where(Site.project_id.in_(project_ids))
        .group_by(Recipe.status)
    )
    rs = {row.status: row.cnt for row in rs_q}
    total_published = rs.get(RecipeStatus.published, 0)
    total_generated = rs.get(RecipeStatus.generated, 0)
    total_pending   = rs.get(RecipeStatus.pending, 0)
    total_failed    = rs.get(RecipeStatus.failed, 0)
    total_recipes   = sum(rs.values())
    success_rate    = round(total_published / total_recipes * 100, 1) if total_recipes else 0.0

    # ── Global job counts ─────────────────────────────────────────────────────
    js_q = await db.execute(
        select(Job.status, func.count().label("cnt"))
        .where(Job.project_id.in_(project_ids))
        .group_by(Job.status)
    )
    js = {row.status: row.cnt for row in js_q}
    total_jobs           = sum(js.values())
    total_jobs_completed = js.get(JobStatus.completed, 0)
    total_jobs_failed    = js.get(JobStatus.failed, 0)

    # ── Last published recipe ─────────────────────────────────────────────────
    lp_q = await db.execute(
        select(Recipe, Site)
        .join(Site, Recipe.site_id == Site.id)
        .where(Site.project_id.in_(project_ids), Recipe.status == RecipeStatus.published)
        .order_by(Recipe.created_at.desc())
        .limit(1)
    )
    lp_row = lp_q.first()
    last_published: LastPublished | None = None
    if lp_row:
        r, s = lp_row
        last_published = LastPublished(
            title=(r.seo_title or r.recipe_text or "").splitlines()[0][:120],
            site_domain=s.domain,
            wp_permalink=r.wp_permalink,
            created_at=r.created_at,
        )

    # ── Monthly stats (last 6 months) ─────────────────────────────────────────
    # Use text("'month'") so the literal is not parameterized — PostgreSQL requires
    # the GROUP BY expression to be identical (not just equal) to the SELECT expression.
    cutoff = datetime.now(timezone.utc) - timedelta(days=183)
    _month_trunc = func.date_trunc(text("'month'"), Recipe.created_at)
    monthly_q = await db.execute(
        select(
            _month_trunc.label("month"),
            func.count().label("total"),
            func.sum(case((Recipe.status == RecipeStatus.published, 1), else_=0)).label("published"),
        )
        .join(Site, Recipe.site_id == Site.id)
        .where(Site.project_id.in_(project_ids), Recipe.created_at >= cutoff)
        .group_by(_month_trunc)
        .order_by(_month_trunc)
    )
    monthly = [
        MonthStat(
            month=row.month.strftime("%b %Y"),
            generated=row.total,
            published=int(row.published or 0),
        )
        for row in monthly_q
    ]

    # ── Recent jobs (last 15) ─────────────────────────────────────────────────
    rj_q = await db.execute(
        select(Job)
        .where(Job.project_id.in_(project_ids))
        .order_by(Job.created_at.desc())
        .limit(15)
    )
    recent_jobs = [
        RecentJob(
            id=str(j.id),
            job_type=j.job_type.value,
            status=j.status.value,
            project_name=project_name_map.get(j.project_id, "Unknown"),
            created_at=j.created_at,
            finished_at=j.finished_at,
            total_rows=j.total_rows,
            current_row=j.current_row,
        )
        for j in rj_q.scalars().all()
    ]

    # ── Per-project / per-site breakdown ──────────────────────────────────────
    all_sites_q = await db.execute(select(Site).where(Site.project_id.in_(project_ids)))
    all_sites = all_sites_q.scalars().all()
    sites_by_project: dict[uuid.UUID, list] = {}
    for s in all_sites:
        sites_by_project.setdefault(s.project_id, []).append(s)

    project_analytics: list[ProjectAnalytics] = []
    for p in projects:
        p_sites = sites_by_project.get(p.id, [])
        site_analytics: list[SiteAnalytics] = []
        p_total = p_pub = p_gen = p_pend = p_fail = 0
        p_last_pub: datetime | None = None

        for s in p_sites:
            sr_q = await db.execute(
                select(Recipe.status, func.count().label("cnt"))
                .where(Recipe.site_id == s.id)
                .group_by(Recipe.status)
            )
            sr = {row.status: row.cnt for row in sr_q}
            s_total = sum(sr.values())
            s_pub   = sr.get(RecipeStatus.published, 0)
            s_gen   = sr.get(RecipeStatus.generated, 0)
            s_pend  = sr.get(RecipeStatus.pending, 0)
            s_fail  = sr.get(RecipeStatus.failed, 0)

            lps_q = await db.execute(
                select(Recipe.created_at, Recipe.recipe_text, Recipe.seo_title)
                .where(Recipe.site_id == s.id, Recipe.status == RecipeStatus.published)
                .order_by(Recipe.created_at.desc())
                .limit(1)
            )
            lps = lps_q.first()
            s_last_pub   = lps.created_at if lps else None
            s_last_title = (lps.seo_title or lps.recipe_text or "").splitlines()[0][:80] if lps else None

            site_analytics.append(SiteAnalytics(
                id=str(s.id), domain=s.domain,
                total=s_total, published=s_pub, generated=s_gen, pending=s_pend, failed=s_fail,
                last_published_at=s_last_pub, last_title=s_last_title,
            ))
            p_total += s_total; p_pub += s_pub; p_gen += s_gen
            p_pend += s_pend;   p_fail += s_fail
            if s_last_pub and (p_last_pub is None or s_last_pub > p_last_pub):
                p_last_pub = s_last_pub

        project_analytics.append(ProjectAnalytics(
            id=str(p.id), name=p.name, site_count=len(p_sites),
            total=p_total, published=p_pub, generated=p_gen, pending=p_pend, failed=p_fail,
            last_published_at=p_last_pub, sites=site_analytics,
        ))

    return OwnerAnalytics(
        total_projects=len(projects),
        total_sites=len(all_sites),
        total_recipes=total_recipes,
        total_published=total_published,
        total_generated=total_generated,
        total_pending=total_pending,
        total_failed=total_failed,
        total_jobs=total_jobs,
        total_jobs_completed=total_jobs_completed,
        total_jobs_failed=total_jobs_failed,
        success_rate=success_rate,
        last_published=last_published,
        recent_jobs=recent_jobs,
        projects=project_analytics,
        monthly=monthly,
    )
