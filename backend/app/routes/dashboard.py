from __future__ import annotations
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import User, UserRole, Project, ProjectMember, Site, Recipe, Job
from ..dependencies import get_current_user
from ..models import DashboardStats, ProjectOut

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardStats)
async def get_dashboard(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if user.role == UserRole.owner:
        projects_q = await db.execute(select(Project).order_by(Project.created_at.desc()))
    else:
        projects_q = await db.execute(
            select(Project)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == user.id)
            .order_by(Project.created_at.desc())
        )

    projects = projects_q.scalars().all()

    total_sites = 0
    total_recipes = 0
    total_jobs = 0
    project_outs = []

    for p in projects:
        sc = await db.scalar(select(func.count()).select_from(Site).where(Site.project_id == p.id)) or 0
        mc = await db.scalar(select(func.count()).select_from(ProjectMember).where(ProjectMember.project_id == p.id)) or 0
        rc = await db.scalar(
            select(func.count()).select_from(Recipe).join(Site, Recipe.site_id == Site.id).where(Site.project_id == p.id)
        ) or 0
        jc = await db.scalar(select(func.count()).select_from(Job).where(Job.project_id == p.id)) or 0

        total_sites += sc
        total_recipes += rc
        total_jobs += jc

        project_outs.append(ProjectOut(
            id=p.id, name=p.name, description=p.description, owner_id=p.owner_id,
            created_at=p.created_at, site_count=sc, member_count=mc,
            recipe_count=rc, job_count=jc,
        ))

    return DashboardStats(
        total_projects=len(projects),
        total_sites=total_sites,
        total_recipes=total_recipes,
        total_jobs=total_jobs,
        projects=project_outs,
    )
