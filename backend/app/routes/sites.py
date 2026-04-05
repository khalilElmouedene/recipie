from __future__ import annotations
import json
import uuid
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from sqlalchemy import select, func, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from ..crypto import encrypt, decrypt
from ..database import get_db
from ..db_models import User, Site, Recipe, Project, ProjectMemberRole
from ..dependencies import get_current_user, check_project_access
from ..services.ssrf import is_safe_url_for_server_fetch as _is_safe_url
from ..models import SiteCreate, SiteUpdate, SiteOut
from ..services import wordpress as wp_service
from ..site_credentials import get_random_wp_credentials

router = APIRouter(tags=["sites"])


class MediaUploadResponse(BaseModel):
    media_id: str
    media_url: str
    post_id: str | None = None
    post_url: str | None = None


_MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB


def _detect_image_magic(data: bytes) -> bool:
    if len(data) < 6:
        return False
    if data[:3] == b"\xff\xd8\xff":
        return True
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return True
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return True
    return False


def _sanitize_upload_filename(name: str) -> str:
    base = (name or "upload.png").replace("\\", "/").split("/")[-1]
    if not base or base in (".", ".."):
        base = "upload.png"
    return base[:200]


def _extension_from_magic(data: bytes) -> str:
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if len(data) >= 6 and data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    return ".jpg"


def _parse_wp_users(site: Site) -> list[dict]:
    """Parse wp_users_enc or legacy wp_username into list of {username}."""
    if site.wp_users_enc:
        try:
            users = json.loads(site.wp_users_enc)
            return [{"username": u.get("username", "")} for u in users if isinstance(u, dict) and u.get("username")]
        except (json.JSONDecodeError, TypeError):
            pass
    if site.wp_username:
        return [{"username": site.wp_username}]
    return []


async def _site_out(site: Site, db: AsyncSession) -> dict:
    recipe_count = await db.scalar(
        select(func.count()).select_from(Recipe).where(Recipe.site_id == site.id)
    ) or 0
    wp_users = _parse_wp_users(site)
    return {
        "id": site.id,
        "project_id": site.project_id,
        "domain": site.domain,
        "wp_url": site.wp_url,
        "wp_users": wp_users,
        "sheet_name": site.sheet_name or "",
        "spreadsheet_id": site.spreadsheet_id or "",
        "pinterest_url": site.pinterest_url or "",
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

    wp_users_enc = json.dumps([
        {"username": u.username, "password_enc": encrypt(u.password)}
        for u in body.wp_users
    ])
    site = Site(
        project_id=project_id,
        domain=body.domain,
        wp_url=body.wp_url,
        wp_users_enc=wp_users_enc,
        sheet_name=body.sheet_name,
        spreadsheet_id=body.spreadsheet_id,
        pinterest_url=body.pinterest_url or None,
    )
    db.add(site)
    await db.commit()
    row = await db.execute(select(Site).where(Site.id == site.id))
    created = row.scalar_one()
    return await _site_out(created, db)


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
    if body.wp_users is not None:
        existing = []
        if site.wp_users_enc:
            try:
                existing = json.loads(site.wp_users_enc)
            except (json.JSONDecodeError, TypeError):
                pass
        existing_by_user = {u.get("username"): u.get("password_enc", "") for u in existing if isinstance(u, dict) and u.get("username")}
        if site.wp_username and site.wp_password_enc:
            existing_by_user[site.wp_username] = site.wp_password_enc
        new_users = []
        for u in body.wp_users:
            pwd_enc = encrypt(u.password) if u.password.strip() else existing_by_user.get(u.username, "")
            if pwd_enc:
                new_users.append({"username": u.username, "password_enc": pwd_enc})
        if new_users:
            site.wp_users_enc = json.dumps(new_users)
    if body.sheet_name is not None:
        site.sheet_name = body.sheet_name
    if body.spreadsheet_id is not None:
        site.spreadsheet_id = body.spreadsheet_id
    if body.pinterest_url is not None:
        site.pinterest_url = body.pinterest_url or None

    await db.commit()
    row = await db.execute(select(Site).where(Site.id == site_id))
    updated = row.scalar_one()
    return await _site_out(updated, db)


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
    await db.execute(sql_delete(Site).where(Site.id == site_id))
    await db.commit()


@router.post("/api/sites/{site_id}/upload-media", response_model=MediaUploadResponse)
async def upload_media_to_wordpress(
    site_id: uuid.UUID,
    file: UploadFile = File(...),
    title: str = Query("Pin Design"),
    create_post: bool = Query(False, description="Create a blog post with the image as featured image"),
    user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    """Upload an image to WordPress media library. Optionally create a blog post."""
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site.project_id, user, db)

    wp_username, wp_password = get_random_wp_credentials(site)
    file_content = await file.read()
    if len(file_content) > _MAX_IMAGE_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image exceeds maximum size (25 MB)",
        )
    if not _detect_image_magic(file_content):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be a JPEG, PNG, WebP, or GIF image",
        )
    filename = _sanitize_upload_filename(file.filename or "pin-design.png")

    try:
        media_result = wp_service.upload_media(
            wp_url=site.wp_url,
            username=wp_username,
            password=wp_password,
            filename=filename,
            file_content=file_content,
            title=title,
        )
        media_id = media_result.get("id", "")
        media_url = media_result.get("url", "")
        
        post_id = None
        post_url = None
        if create_post and media_id:
            post_result = wp_service.create_pin_post(
                wp_url=site.wp_url,
                username=wp_username,
                password=wp_password,
                title=title,
                media_id=int(media_id) if isinstance(media_id, str) else media_id,
            )
            post_id = str(post_result.get("post_id", ""))
            post_url = post_result.get("post_url", "")
        
        return MediaUploadResponse(
            media_id=str(media_id),
            media_url=media_url,
            post_id=post_id,
            post_url=post_url,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail="WordPress operation failed")


@router.post("/api/sites/{site_id}/upload-from-url", response_model=MediaUploadResponse)
async def upload_from_url_to_wordpress(
    site_id: uuid.UUID,
    image_url: str = Query(..., description="URL of the image to upload"),
    title: str = Query("Pin Design"),
    create_post: bool = Query(True),
    user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    """Fetch image from URL and upload to WordPress."""
    if not _is_safe_url(image_url):
        raise HTTPException(status_code=400, detail="URL not allowed")

    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site.project_id, user, db)

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            async with client.stream("GET", image_url, timeout=30) as resp:
                resp.raise_for_status()
                ctype = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
                if ctype and not ctype.startswith("image/"):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="URL does not point to an image",
                    )
                total = 0
                chunks: list[bytes] = []
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    total += len(chunk)
                    if total > _MAX_IMAGE_UPLOAD_BYTES:
                        raise HTTPException(
                            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail="Image exceeds maximum size (25 MB)",
                        )
                    chunks.append(chunk)
                file_content = b"".join(chunks)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch image: {e}")

    if not _detect_image_magic(file_content):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Downloaded file is not a supported image type",
        )

    ext = _extension_from_magic(file_content)
    filename = f"recipe-{uuid.uuid4().hex[:8]}{ext}"

    wp_username, wp_password = get_random_wp_credentials(site)
    try:
        media_result = wp_service.upload_media(
            wp_url=site.wp_url,
            username=wp_username,
            password=wp_password,
            filename=filename,
            file_content=file_content,
            title=title,
        )
        media_id = media_result.get("id", "")
        media_url = media_result.get("url", "")
        post_id = None
        post_url = None
        if create_post and media_id:
            post_result = wp_service.create_pin_post(
                wp_url=site.wp_url,
                username=wp_username,
                password=wp_password,
                title=title,
                media_id=int(media_id) if isinstance(media_id, str) else media_id,
            )
            post_id = str(post_result.get("post_id", ""))
            post_url = post_result.get("post_url", "")
        return MediaUploadResponse(
            media_id=str(media_id),
            media_url=media_url,
            post_id=post_id,
            post_url=post_url,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail="WordPress operation failed")
