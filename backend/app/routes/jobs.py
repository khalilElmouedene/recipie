from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import case, func, or_, select, delete as sql_delete, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import User, Job, JobLog, JobType, JobStatus, Project, Recipe, RecipeStatus, Site, ProjectMemberRole
from ..dependencies import get_current_user, check_project_access
from ..models import JobStart, JobOut, JobLogOut, JobPublishSummaryOut, GeneratedJobRecipeOut, GeneratedJobSiteSummaryOut
from ..pagination import apply_limit_offset, count_rows, set_total_count
from ..workers.job_manager import PUBLISH_META_PREFIX, job_manager

router = APIRouter(tags=["jobs"])
limiter = Limiter(key_func=get_remote_address)


@router.post("/api/projects/{project_id}/jobs", response_model=JobOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def start_job(
    request: Request,
    project_id: uuid.UUID,
    body: JobStart,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db)

    prj = await db.execute(select(Project).where(Project.id == project_id))
    if not prj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    if body.job_type not in ("articles", "publisher", "articles_all_sites"):
        raise HTTPException(status_code=400, detail="Invalid job type")
    if body.job_type == "articles_all_sites":
        if body.site_id or body.recipe_id:
            raise HTTPException(status_code=400, detail="articles_all_sites does not accept site_id/recipe_id")
        if not body.shared_recipes:
            raise HTTPException(status_code=400, detail="shared_recipes is required for articles_all_sites")


    job = Job(
        project_id=project_id,
        created_by=user.id,
        job_type=JobType(body.job_type),
        status=JobStatus.pending,
    )
    db.add(job)
    await db.commit()

    row = await db.execute(select(Job).where(Job.id == job.id))
    job = row.scalar_one()

    await job_manager.start_job(job, body.site_id, body.recipe_id, db, body.shared_recipes)

    row2 = await db.execute(select(Job).where(Job.id == job.id))
    return row2.scalar_one()


@router.get("/api/projects/{project_id}/jobs", response_model=list[JobOut])
async def list_project_jobs(
    response: Response,
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    job_type: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    await check_project_access(project_id, user, db)
    stmt = select(Job).where(Job.project_id == project_id)
    if job_type:
        try:
            stmt = stmt.where(Job.job_type == JobType(job_type))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid job type")
    stmt = stmt.order_by(Job.created_at.desc())
    total = await count_rows(db, stmt)
    set_total_count(response, total)
    result = await db.execute(apply_limit_offset(stmt, limit, offset))
    return result.scalars().all()


@router.get("/api/jobs/{job_id}", response_model=JobOut)
async def get_job(
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_project_access(job.project_id, user, db)
    return job


@router.get("/api/jobs/{job_id}/publish-summary", response_model=JobPublishSummaryOut)
async def get_job_publish_summary(
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_project_access(job.project_id, user, db)
    if job.job_type != JobType.publisher:
        raise HTTPException(status_code=400, detail="Publish summary is only available for publisher jobs")

    counts_result = await db.execute(
        select(
            func.count(Recipe.id).label("total"),
            func.coalesce(func.sum(case((Recipe.status == RecipeStatus.published, 1), else_=0)), 0).label("succeeded"),
            func.coalesce(func.sum(case((Recipe.status == RecipeStatus.failed, 1), else_=0)), 0).label("failed"),
            func.coalesce(
                func.sum(
                    case(
                        (Recipe.status.in_([RecipeStatus.generated, RecipeStatus.publishing]), 1),
                        else_=0,
                    )
                ),
                0,
            ).label("remaining"),
        ).where(Recipe.created_by_job_id == job_id)
    )
    row = counts_result.one()
    total = int(row.total or 0)
    succeeded = int(row.succeeded or 0)
    failed = int(row.failed or 0)
    remaining = int(row.remaining or 0)
    processed = max(0, total - remaining)
    return JobPublishSummaryOut(
        total=total,
        processed=processed,
        succeeded=succeeded,
        failed=failed,
        remaining=remaining,
    )


@router.get("/api/jobs/{job_id}/logs", response_model=list[JobLogOut])
async def get_job_logs(
    response: Response,
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int | None = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_project_access(job.project_id, user, db)

    stmt = (
        select(JobLog)
        .where(
            JobLog.job_id == job_id,
            JobLog.message.notlike(f"{PUBLISH_META_PREFIX}%"),
        )
        .order_by(JobLog.created_at.asc())
    )
    total = await count_rows(db, stmt)
    set_total_count(response, total)
    logs = await db.execute(apply_limit_offset(stmt, limit, offset))
    return logs.scalars().all()


@router.get("/api/jobs/{job_id}/generated-recipes", response_model=list[GeneratedJobRecipeOut])
async def get_job_generated_recipes(
    response: Response,
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    site_id: uuid.UUID | None = None,
    limit: int | None = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_project_access(job.project_id, user, db)

    query = (
        select(Recipe, Site.domain)
        .join(Site, Recipe.site_id == Site.id)
        .where(Recipe.created_by_job_id == job_id)
    )
    if site_id is not None:
        query = query.where(Recipe.site_id == site_id)
    stmt = query.order_by(Site.domain.asc(), Recipe.created_at.asc())
    total = await count_rows(db, stmt)
    set_total_count(response, total)
    rows = await db.execute(apply_limit_offset(stmt, limit, offset))
    out: list[GeneratedJobRecipeOut] = []
    for recipe, domain in rows.all():
        out.append(
            GeneratedJobRecipeOut(
                id=recipe.id,
                site_id=recipe.site_id,
                site_domain=domain,
                recipe_text=recipe.recipe_text,
                status=recipe.status.value if hasattr(recipe.status, "value") else str(recipe.status),
                wp_permalink=recipe.wp_permalink,
                image_url=recipe.image_url or "",
                generated_images=recipe.generated_images,
                category=recipe.category,
                pin_title=recipe.pin_title,
                pin_description=recipe.pin_description,
                pin_template_id=recipe.pin_template_id,
                created_at=recipe.created_at,
            )
    )
    return out


@router.get("/api/jobs/{job_id}/generated-sites-summary", response_model=list[GeneratedJobSiteSummaryOut])
async def get_job_generated_sites_summary(
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_project_access(job.project_id, user, db)

    published_case = case(
        (
            or_(
                Recipe.status == RecipeStatus.published,
                Recipe.wp_permalink.is_not(None),
            ),
            1,
        ),
        else_=0,
    )

    stmt = (
        select(
            Site.id.label("site_id"),
            Site.domain.label("site_domain"),
            func.count(Recipe.id).label("recipe_count"),
            func.sum(published_case).label("published_count"),
        )
        .join(Site, Recipe.site_id == Site.id)
        .where(Recipe.created_by_job_id == job_id)
        .group_by(Site.id, Site.domain)
        .order_by(Site.domain.asc(), Site.id.asc())
    )
    rows = await db.execute(stmt)
    return [
        GeneratedJobSiteSummaryOut(
            site_id=row.site_id,
            site_domain=row.site_domain,
            recipe_count=int(row.recipe_count or 0),
            published_count=int(row.published_count or 0),
        )
        for row in rows
    ]


@router.delete("/api/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job_and_linked_recipes(
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_project_access(job.project_id, user, db, require_roles=[ProjectMemberRole.admin])
    if job.job_type != JobType.articles_all_sites:
        raise HTTPException(
            status_code=400,
            detail="Only articles_all_sites jobs can be deleted from this action",
        )
    if job.status == JobStatus.running:
        raise HTTPException(status_code=400, detail="Stop the job before deleting")
    await db.execute(sql_delete(Recipe).where(Recipe.created_by_job_id == job_id))
    await db.execute(sql_delete(Job).where(Job.id == job_id))
    await db.commit()


@router.post("/api/jobs/{job_id}/resume", response_model=JobOut)
async def resume_job_endpoint(
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_project_access(job.project_id, user, db)

    RESUMABLE_TYPES = {JobType.articles_all_sites, JobType.articles, JobType.publisher, JobType.auto_spy_generate}
    if job.job_type not in RESUMABLE_TYPES:
        raise HTTPException(status_code=400, detail="This job type cannot be resumed.")

    if job.status not in (JobStatus.stopped, JobStatus.failed):
        raise HTTPException(status_code=400, detail="Job must be stopped or failed to resume.")

    dup = await db.execute(
        select(Job).where(
            Job.project_id == job.project_id,
            Job.job_type == job.job_type,
            Job.status.in_([JobStatus.running, JobStatus.pending]),
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Another job of the same type is already running for this project.")

    # Revert any recipes stuck in 'generating' back to 'pending'
    await db.execute(
        sql_update(Recipe)
        .where(Recipe.created_by_job_id == job.id, Recipe.status == RecipeStatus.generating)
        .values(status=RecipeStatus.pending)
    )
    job.status = JobStatus.pending
    job.error = None
    job.finished_at = None
    await db.commit()

    await job_manager.resume_job(job.id)

    row = await db.execute(select(Job).where(Job.id == job_id))
    return row.scalar_one()


@router.post("/api/jobs/{job_id}/stop", response_model=JobOut)
async def stop_job(
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_project_access(job.project_id, user, db)

    job_manager.stop_job(str(job.id))
    # Immediately revert any recipes still generating so the UI clears right away
    await db.execute(
        sql_update(Recipe)
        .where(Recipe.created_by_job_id == job.id, Recipe.status == RecipeStatus.generating)
        .values(status=RecipeStatus.pending)
    )
    job.status = JobStatus.stopped
    await db.commit()
    row = await db.execute(select(Job).where(Job.id == job_id))
    return row.scalar_one()
