from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import User, Job, JobLog, JobType, JobStatus, Project
from ..dependencies import get_current_user, check_project_access
from ..models import JobStart, JobOut, JobLogOut
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
    job.status = JobStatus.stopped
    await db.commit()
    row = await db.execute(select(Job).where(Job.id == job_id))
    return row.scalar_one()
