from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..crypto import encrypt
from ..database import get_db
from ..db_models import User, Site, Recipe, Project, ProjectMemberRole
from ..dependencies import get_current_user, check_project_access
from ..models import SiteCreate, SiteUpdate, SiteOut

router = APIRouter(tags=["sites"])


async def _site_out(site: Site, db: AsyncSession) -> dict:
    recipe_count = await db.scalar(
        select(func.count()).select_from(Recipe).where(Recipe.site_id == site.id)
    ) or 0
    return {
        "id": site.id,
        "project_id": site.project_id,
        "domain": site.domain,
        "wp_url": site.wp_url,
        "wp_username": site.wp_username,
        "sheet_name": site.sheet_name,
        "spreadsheet_id": site.spreadsheet_id,
        "created_at": site.created_at,
        "recipe_count": recipe_count,
    }


@router.get("/api/projects/{project_id}/sites", response_model=list[SiteOut])
async def list_sites(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db)
    result = await db.execute(
        select(Site).where(Site.project_id == project_id).order_by(Site.created_at.desc())
    )
    sites = result.scalars().all()
    return [await _site_out(s, db) for s in sites]


@router.post("/api/projects/{project_id}/sites", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
async def create_site(
    project_id: uuid.UUID,
    body: SiteCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db, require_roles=[ProjectMemberRole.admin])
    prj = await db.execute(select(Project).where(Project.id == project_id))
    if not prj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    site = Site(
        project_id=project_id,
        domain=body.domain,
        wp_url=body.wp_url,
        wp_username=body.wp_username,
        wp_password_enc=encrypt(body.wp_password),
        sheet_name=body.sheet_name,
        spreadsheet_id=body.spreadsheet_id,
    )
    db.add(site)
    await db.commit()
    await db.refresh(site)
    return await _site_out(site, db)


@router.patch("/api/sites/{site_id}", response_model=SiteOut)
async def update_site(
    site_id: uuid.UUID,
    body: SiteUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site.project_id, user, db, require_roles=[ProjectMemberRole.admin])

    if body.domain is not None:
        site.domain = body.domain
    if body.wp_url is not None:
        site.wp_url = body.wp_url
    if body.wp_username is not None:
        site.wp_username = body.wp_username
    if body.wp_password is not None:
        site.wp_password_enc = encrypt(body.wp_password)
    if body.sheet_name is not None:
        site.sheet_name = body.sheet_name
    if body.spreadsheet_id is not None:
        site.spreadsheet_id = body.spreadsheet_id

    await db.commit()
    await db.refresh(site)
    return await _site_out(site, db)


@router.delete("/api/sites/{site_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_site(
    site_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site.project_id, user, db, require_roles=[ProjectMemberRole.admin])
    await db.delete(site)
    await db.commit()
