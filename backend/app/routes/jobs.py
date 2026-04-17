from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete as sql_delete, update as sql_update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import User, Job, JobLog, JobType, JobStatus, Project, Recipe, RecipeStatus, Site, ProjectMemberRole
from ..dependencies import get_current_user, check_project_access
from ..models import JobStart, JobOut, JobLogOut, GeneratedJobRecipeOut
from ..workers.job_manager import job_manager

router = APIRouter(tags=["jobs"])


@router.post("/api/projects/{project_id}/jobs", response_model=JobOut, status_code=status.HTTP_201_CREATED)
async def start_job(
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

    # ── Concurrency guards ────────────────────────────────────────────────────
    # Include BOTH running AND pending: when two requests arrive simultaneously,
    # the first creates a job (status=pending) before the thread marks it running.
    # Checking only running would let the second request through during that window.
    _ACTIVE = [JobStatus.running, JobStatus.pending]

    if body.job_type == "articles_all_sites":
        dup = await db.execute(
            select(Job).where(
                Job.project_id == project_id,
                Job.job_type == JobType.articles_all_sites,
                Job.status.in_(_ACTIVE),
            )
        )
        if dup.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail="A generation job is already running for this project. Wait for it to finish before starting a new one.",
            )

    elif body.job_type == "articles":
        if body.recipe_id:
            rq = await db.execute(select(Recipe).where(Recipe.id == body.recipe_id))
            rcp = rq.scalar_one_or_none()
            if rcp and rcp.status == RecipeStatus.generating:
                raise HTTPException(
                    status_code=409,
                    detail="This recipe is already being generated. Wait for it to complete.",
                )
        else:
            dup = await db.execute(
                select(Job).where(
                    Job.project_id == project_id,
                    Job.job_type == JobType.articles,
                    Job.status.in_(_ACTIVE),
                )
            )
            if dup.scalar_one_or_none():
                raise HTTPException(
                    status_code=409,
                    detail="A generation job is already running for this site. Wait for it to finish.",
                )

    elif body.job_type == "publisher":
        if body.site_id:
            dup = await db.execute(
                select(Job).where(
                    Job.project_id == project_id,
                    Job.job_type == JobType.publisher,
                    Job.status.in_(_ACTIVE),
                )
            )
            if dup.scalar_one_or_none():
                raise HTTPException(
                    status_code=409,
                    detail="A publish job is already running. Wait for it to finish.",
                )
    # ─────────────────────────────────────────────────────────────────────────

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
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db)
    result = await db.execute(
        select(Job).where(Job.project_id == project_id).order_by(Job.created_at.desc())
    )
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


@router.get("/api/jobs/{job_id}/logs", response_model=list[JobLogOut])
async def get_job_logs(
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await check_project_access(job.project_id, user, db)

    logs = await db.execute(
        select(JobLog).where(JobLog.job_id == job_id).order_by(JobLog.created_at.asc())
    )
    return logs.scalars().all()


@router.get("/api/jobs/{job_id}/generated-recipes", response_model=list[GeneratedJobRecipeOut])
async def get_job_generated_recipes(
    job_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    site_id: uuid.UUID | None = None,
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
    rows = await db.execute(
        query.order_by(Site.domain.asc(), Recipe.created_at.asc())
    )
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
                pin_template_id=recipe.pin_template_id,
                created_at=recipe.created_at,
            )
        )
    return out


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
