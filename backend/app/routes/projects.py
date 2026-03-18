from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select, func, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..config import settings
from ..database import get_db
from ..db_models import (
    User, UserRole, Project, ProjectMember, ProjectMemberRole,
    Site, Recipe, Job, ProjectPublishSchedule,
)
from ..dependencies import get_current_user, require_owner, check_project_access
from ..models import (
    ProjectCreate, ProjectUpdate, ProjectOut, MemberAdd, MemberOut,
    PublishScheduleOut, PublishScheduleUpdate,
)
from ..services.email_service import send_project_invite_email

router = APIRouter(prefix="/api/projects", tags=["projects"])


async def _project_out(project: Project, db: AsyncSession) -> dict:
    site_count = await db.scalar(
        select(func.count()).select_from(Site).where(Site.project_id == project.id)
    ) or 0
    member_count = await db.scalar(
        select(func.count()).select_from(ProjectMember).where(ProjectMember.project_id == project.id)
    ) or 0
    recipe_count = await db.scalar(
        select(func.count())
        .select_from(Recipe)
        .join(Site, Recipe.site_id == Site.id)
        .where(Site.project_id == project.id)
    ) or 0
    job_count = await db.scalar(
        select(func.count()).select_from(Job).where(Job.project_id == project.id)
    ) or 0

    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "owner_id": project.owner_id,
        "created_at": project.created_at,
        "site_count": site_count,
        "member_count": member_count,
        "recipe_count": recipe_count,
        "job_count": job_count,
    }


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Every user (including owner) sees only their own projects or ones they're a member of
    result = await db.execute(
        select(Project)
        .where(
            (Project.owner_id == user.id) |
            (Project.id.in_(
                select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
            ))
        )
        .order_by(Project.created_at.desc())
    )
    projects = result.scalars().all()
    return [await _project_out(p, db) for p in projects]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    owner: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = Project(name=body.name, description=body.description, owner_id=owner.id)
    db.add(project)
    await db.flush()  # get project.id before commit
    # Auto-add creator as admin member so they always appear in the member list
    member = ProjectMember(project_id=project.id, user_id=owner.id, role=ProjectMemberRole.admin)
    db.add(member)
    await db.commit()
    row = await db.execute(select(Project).where(Project.id == project.id))
    created = row.scalar_one()
    return await _project_out(created, db)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db)
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return await _project_out(project, db)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db, require_roles=[ProjectMemberRole.admin])
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    await db.commit()
    row = await db.execute(select(Project).where(Project.id == project_id))
    updated = row.scalar_one()
    return await _project_out(updated, db)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: uuid.UUID,
    _owner: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Project).where(Project.id == project_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")
    await db.execute(sql_delete(Project).where(Project.id == project_id))
    await db.commit()


# ── Members ──────────────────────────────────────────────────────────

@router.get("/{project_id}/members", response_model=list[MemberOut])
async def list_members(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db)
    result = await db.execute(
        select(ProjectMember)
        .options(selectinload(ProjectMember.user))
        .where(ProjectMember.project_id == project_id)
    )
    members = result.scalars().all()
    return [
        MemberOut(
            id=m.id,
            user_id=m.user_id,
            email=m.user.email,
            full_name=m.user.full_name,
            role=m.role.value,
        )
        for m in members
    ]


@router.post("/{project_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
async def add_member(
    project_id: uuid.UUID,
    body: MemberAdd,
    _owner: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    prj = await db.execute(select(Project).where(Project.id == project_id))
    prj_obj = prj.scalar_one_or_none()
    if not prj_obj:
        raise HTTPException(status_code=404, detail="Project not found")

    usr = await db.execute(select(User).where(User.id == body.user_id))
    user_obj = usr.scalar_one_or_none()
    if not user_obj:
        raise HTTPException(status_code=404, detail="User not found")

    existing = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == body.user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User already a member")

    if body.role not in ("admin", "member"):
        raise HTTPException(status_code=400, detail="Invalid role")

    member = ProjectMember(
        project_id=project_id,
        user_id=body.user_id,
        role=ProjectMemberRole(body.role),
    )
    db.add(member)
    await db.commit()

    try:
        await send_project_invite_email(
            user_obj.email,
            user_obj.full_name,
            prj_obj.name,
            body.role,
            settings.frontend_url,
        )
    except Exception as exc:
        print(f"[email] Failed to send project invite email: {exc}")

    return MemberOut(
        id=member.id,
        user_id=member.user_id,
        email=user_obj.email,
        full_name=user_obj.full_name,
        role=body.role,
    )


@router.get("/{project_id}/export/excel")
async def export_project_excel(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Export all recipes for all sites in this project as an Excel file.
    One sheet per site, matching the V1 Project structure."""
    await check_project_access(project_id, user, db)

    project_row = await db.execute(select(Project).where(Project.id == project_id))
    project = project_row.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    sites_row = await db.execute(
        select(Site).where(Site.project_id == project_id).order_by(Site.created_at.asc())
    )
    sites = sites_row.scalars().all()

    from ..services.excel_export import build_project_excel

    sites_with_recipes: list[tuple] = []
    for site in sites:
        recipes_row = await db.execute(
            select(Recipe).where(Recipe.site_id == site.id).order_by(Recipe.created_at.asc())
        )
        recipes = recipes_row.scalars().all()
        sites_with_recipes.append((site, list(recipes)))

    xlsx_bytes = build_project_excel(project.name, sites_with_recipes)
    safe_name = project.name.replace(" ", "_").replace("/", "_")[:40]
    filename = f"{safe_name}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{project_id}/duplicate", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def duplicate_project(
    project_id: uuid.UUID,
    owner: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a copy of the project with its sites (no recipes/jobs)."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    source = result.scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Project not found")

    new_project = Project(
        name=f"{source.name} (copy)",
        description=source.description,
        owner_id=owner.id,
    )
    db.add(new_project)
    await db.flush()

    # Copy sites (no recipes)
    sites_result = await db.execute(select(Site).where(Site.project_id == project_id))
    for s in sites_result.scalars().all():
        db.add(Site(
            project_id=new_project.id,
            domain=s.domain,
            wp_url=s.wp_url,
            wp_users_enc=s.wp_users_enc,
            wp_username=s.wp_username,
            wp_password_enc=s.wp_password_enc,
        ))

    # Add owner as admin member
    db.add(ProjectMember(project_id=new_project.id, user_id=owner.id, role=ProjectMemberRole.admin))
    await db.commit()

    row = await db.execute(select(Project).where(Project.id == new_project.id))
    return await _project_out(row.scalar_one(), db)


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    _owner: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Member not found")
    await db.execute(
        sql_delete(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    await db.commit()


@router.get("/{project_id}/publish-schedule", response_model=PublishScheduleOut)
async def get_publish_schedule(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db)
    row = await db.execute(select(ProjectPublishSchedule).where(ProjectPublishSchedule.project_id == project_id))
    s = row.scalar_one_or_none()
    if not s:
        return PublishScheduleOut(
            enabled=False,
            interval_minutes=240,
            image_retention_days=4,
            next_run_at=None,
            last_run_at=None,
            last_error=None,
        )
    return PublishScheduleOut(
        enabled=s.enabled,
        interval_minutes=s.interval_minutes,
        image_retention_days=s.image_retention_days,
        next_run_at=s.next_run_at,
        last_run_at=s.last_run_at,
        last_error=s.last_error,
    )


@router.put("/{project_id}/publish-schedule", response_model=PublishScheduleOut)
async def set_publish_schedule(
    project_id: uuid.UUID,
    body: PublishScheduleUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db, require_roles=[ProjectMemberRole.admin])
    row = await db.execute(select(ProjectPublishSchedule).where(ProjectPublishSchedule.project_id == project_id))
    s = row.scalar_one_or_none()
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    if not s:
        s = ProjectPublishSchedule(
            project_id=project_id,
            enabled=body.enabled,
            interval_minutes=body.interval_minutes,
            image_retention_days=body.image_retention_days,
            next_run_at=(now + timedelta(minutes=body.interval_minutes)) if body.enabled else None,
            last_error=None,
        )
        db.add(s)
    else:
        prev_enabled = s.enabled
        prev_interval = s.interval_minutes
        s.enabled = body.enabled
        s.interval_minutes = body.interval_minutes
        s.image_retention_days = body.image_retention_days
        if not body.enabled:
            s.next_run_at = None
        elif (not prev_enabled) or (prev_interval != body.interval_minutes) or (s.next_run_at is None):
            s.next_run_at = now + timedelta(minutes=body.interval_minutes)
        s.last_error = None
    await db.commit()
    return PublishScheduleOut(
        enabled=s.enabled,
        interval_minutes=s.interval_minutes,
        image_retention_days=s.image_retention_days,
        next_run_at=s.next_run_at,
        last_run_at=s.last_run_at,
        last_error=s.last_error,
    )


@router.post("/{project_id}/publish-schedule/start-now", response_model=PublishScheduleOut)
async def start_publish_schedule_now(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db, require_roles=[ProjectMemberRole.admin])
    row = await db.execute(select(ProjectPublishSchedule).where(ProjectPublishSchedule.project_id == project_id))
    s = row.scalar_one_or_none()
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    if not s:
        s = ProjectPublishSchedule(
            project_id=project_id,
            enabled=True,
            interval_minutes=240,
            image_retention_days=4,
            next_run_at=now,
            last_error=None,
        )
        db.add(s)
    else:
        s.enabled = True
        s.next_run_at = now
        s.last_error = None
    await db.commit()
    return PublishScheduleOut(
        enabled=s.enabled,
        interval_minutes=s.interval_minutes,
        image_retention_days=s.image_retention_days,
        next_run_at=s.next_run_at,
        last_run_at=s.last_run_at,
        last_error=s.last_error,
    )
