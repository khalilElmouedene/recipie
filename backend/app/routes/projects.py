from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..db_models import (
    User, UserRole, Project, ProjectMember, ProjectMemberRole,
    Site, Recipe, Job,
)
from ..dependencies import get_current_user, require_owner, check_project_access
from ..models import (
    ProjectCreate, ProjectUpdate, ProjectOut, MemberAdd, MemberOut,
)

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
    if user.role == UserRole.owner:
        result = await db.execute(select(Project).order_by(Project.created_at.desc()))
    else:
        result = await db.execute(
            select(Project)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == user.id)
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
    if not prj.scalar_one_or_none():
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

    return MemberOut(
        id=member.id,
        user_id=member.user_id,
        email=user_obj.email,
        full_name=user_obj.full_name,
        role=body.role,
    )


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
