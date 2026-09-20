from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import User, Project, ProjectMember, Site, Recipe, Job, Prompt
from ..dependencies import get_current_user
from ..services.prompts import DEFAULT_PROMPTS

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

ANALYTICS_VIEWER_EMAIL = "khalil@gmail.com"


class AnalyticsPrompt(BaseModel):
    key: str
    value: str
    description: str
    source: str
    updated_at: datetime | None = None


class AnalyticsProject(BaseModel):
    id: str
    name: str
    description: str
    owner_id: str
    owner_email: str
    created_at: datetime
    site_count: int
    recipe_count: int
    job_count: int
    member_count: int
    custom_prompt_count: int
    prompts: list[AnalyticsPrompt]


class AnalyticsPromptBrowser(BaseModel):
    total_projects: int
    total_prompts: int
    projects: list[AnalyticsProject]


def _require_analytics_viewer(user: User) -> None:
    if user.email.strip().lower() != ANALYTICS_VIEWER_EMAIL:
        raise HTTPException(status_code=403, detail="Analytics is only available to Khalil")


def _prompt_out(prompt: Prompt | None, key: str, source: str) -> AnalyticsPrompt:
    default = DEFAULT_PROMPTS.get(key, {})
    return AnalyticsPrompt(
        key=key,
        value=prompt.value if prompt else default.get("value", ""),
        description=(prompt.description if prompt else default.get("description", "")) or "",
        source=source,
        updated_at=prompt.updated_at if prompt else None,
    )


@router.get("", response_model=AnalyticsPromptBrowser)
async def get_analytics(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _require_analytics_viewer(user)

    project_rows = await db.execute(
        select(Project, User.email)
        .join(User, Project.owner_id == User.id)
        .order_by(Project.created_at.desc())
    )
    projects = project_rows.all()
    if not projects:
        return AnalyticsPromptBrowser(total_projects=0, total_prompts=0, projects=[])

    project_ids = [project.id for project, _owner_email in projects]
    owner_ids = {project.owner_id for project, _owner_email in projects}

    site_counts_result = await db.execute(
        select(Site.project_id, func.count(Site.id))
        .where(Site.project_id.in_(project_ids))
        .group_by(Site.project_id)
    )
    site_counts = {project_id: count for project_id, count in site_counts_result.all()}

    recipe_counts_result = await db.execute(
        select(Site.project_id, func.count(Recipe.id))
        .join(Recipe, Recipe.site_id == Site.id)
        .where(Site.project_id.in_(project_ids))
        .group_by(Site.project_id)
    )
    recipe_counts = {project_id: count for project_id, count in recipe_counts_result.all()}

    job_counts_result = await db.execute(
        select(Job.project_id, func.count(Job.id))
        .where(Job.project_id.in_(project_ids))
        .group_by(Job.project_id)
    )
    job_counts = {project_id: count for project_id, count in job_counts_result.all()}

    member_counts_result = await db.execute(
        select(ProjectMember.project_id, func.count(ProjectMember.id))
        .where(ProjectMember.project_id.in_(project_ids))
        .group_by(ProjectMember.project_id)
    )
    member_counts = {project_id: count for project_id, count in member_counts_result.all()}

    owner_prompts_result = await db.execute(
        select(Prompt).where(
            Prompt.owner_id.in_(owner_ids),
            Prompt.project_id.is_(None),
        )
    )
    owner_prompts: dict[tuple[object, str], Prompt] = {
        (prompt.owner_id, prompt.key): prompt
        for prompt in owner_prompts_result.scalars().all()
    }

    project_prompts_result = await db.execute(
        select(Prompt).where(Prompt.project_id.in_(project_ids))
    )
    project_prompts: dict[tuple[object, str], Prompt] = {
        (prompt.project_id, prompt.key): prompt
        for prompt in project_prompts_result.scalars().all()
        if prompt.project_id is not None
    }

    default_keys = list(DEFAULT_PROMPTS.keys())
    default_key_set = set(default_keys)
    analytics_projects: list[AnalyticsProject] = []
    total_prompts = 0

    for project, owner_email in projects:
        project_keys = {
            key
            for prompt_project_id, key in project_prompts
            if prompt_project_id == project.id
        }
        owner_keys = {
            key
            for prompt_owner_id, key in owner_prompts
            if prompt_owner_id == project.owner_id
        }
        prompt_keys = [*default_keys, *sorted((project_keys | owner_keys) - default_key_set)]

        prompts: list[AnalyticsPrompt] = []
        for key in prompt_keys:
            project_prompt = project_prompts.get((project.id, key))
            if project_prompt is not None:
                prompts.append(_prompt_out(project_prompt, key, "project"))
                continue

            owner_prompt = owner_prompts.get((project.owner_id, key))
            if owner_prompt is not None:
                prompts.append(_prompt_out(owner_prompt, key, "owner"))
                continue

            prompts.append(_prompt_out(None, key, "default"))

        total_prompts += len(prompts)
        analytics_projects.append(
            AnalyticsProject(
                id=str(project.id),
                name=project.name,
                description=project.description or "",
                owner_id=str(project.owner_id),
                owner_email=owner_email,
                created_at=project.created_at,
                site_count=site_counts.get(project.id, 0),
                recipe_count=recipe_counts.get(project.id, 0),
                job_count=job_counts.get(project.id, 0),
                member_count=member_counts.get(project.id, 0),
                custom_prompt_count=len(project_keys),
                prompts=prompts,
            )
        )

    return AnalyticsPromptBrowser(
        total_projects=len(analytics_projects),
        total_prompts=total_prompts,
        projects=analytics_projects,
    )
