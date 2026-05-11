from __future__ import annotations
import json
import mimetypes
import uuid
from pathlib import Path
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status, UploadFile, File, Query
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select, func, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from ..crypto import encrypt, decrypt
from ..database import get_db
from ..db_models import User, Site, Recipe, Project, ProjectMemberRole
from ..dependencies import get_current_user, check_project_access
from .recipes import _is_safe_url
from ..models import SiteCreate, SiteUpdate, SiteOut
from ..pagination import apply_limit_offset, count_rows, set_total_count
from ..config import settings
from ..services import wordpress as wp_service
from ..site_credentials import get_random_wp_credentials

UPLOADS_ROOT = Path("/app/uploads")
_RECIPE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
_RECIPE_IMAGE_EXT = {
    ".jpg": ("image/jpeg", "image/jpg"),
    ".jpeg": ("image/jpeg",),
    ".png": ("image/png",),
    ".webp": ("image/webp",),
    ".gif": ("image/gif",),
}

router = APIRouter(tags=["sites"])
limiter = Limiter(key_func=get_remote_address)
_REMOTE_IMAGE_FETCH_MAX_BYTES = 10 * 1024 * 1024
_REMOTE_IMAGE_FETCH_CHUNK_SIZE = 64 * 1024


class MediaUploadResponse(BaseModel):
    media_id: str
    media_url: str
    post_id: str | None = None
    post_url: str | None = None


class RecipeImageUploadResponse(BaseModel):
    url: str


def _recipe_image_extension(file: UploadFile, raw: bytes) -> str:
    """Return a normalized extension from filename, Content-Type, or sniff."""
    name = (file.filename or "").lower().strip()
    for ext in _RECIPE_IMAGE_EXT:
        if name.endswith(ext):
            return ".jpg" if ext == ".jpeg" else ext
    ct = (file.content_type or "").split(";")[0].strip().lower()
    for ext, types in _RECIPE_IMAGE_EXT.items():
        if ct in types:
            return ".jpg" if ext == ".jpeg" else ext
    guess, _ = mimetypes.guess_type(file.filename or "")
    if guess:
        for ext, types in _RECIPE_IMAGE_EXT.items():
            if guess.lower() in types:
                return ".jpg" if ext == ".jpeg" else ext
    if raw.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if raw.startswith(b"GIF87a") or raw.startswith(b"GIF89a"):
        return ".gif"
    if raw.startswith(b"RIFF") and len(raw) >= 12 and raw[8:12] == b"WEBP":
        return ".webp"
    raise HTTPException(status_code=400, detail="Unsupported image type; use JPEG, PNG, WebP, or GIF")


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
        "image_mode": site.image_mode or "featured_and_top",
        "embed_pin_in_article": bool(site.embed_pin_in_article),
        "generate_recipe_json": bool(getattr(site, "generate_recipe_json", True)),
        "pin_template_id": site.pin_template_id,
        "created_at": site.created_at,
        "recipe_count": recipe_count,
    }


@router.get("/api/projects/{project_id}/sites", response_model=list[SiteOut])
async def list_sites(
    response: Response,
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int | None = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    await check_project_access(project_id, user, db)
    stmt = select(Site).where(Site.project_id == project_id).order_by(Site.created_at.desc())
    total = await count_rows(db, stmt)
    set_total_count(response, total)
    result = await db.execute(apply_limit_offset(stmt, limit, offset))
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
        image_mode=body.image_mode if body.image_mode in ("featured_only", "featured_and_top") else "featured_and_top",
        embed_pin_in_article=body.embed_pin_in_article,
        generate_recipe_json=body.generate_recipe_json,
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
    if body.image_mode is not None:
        site.image_mode = body.image_mode if body.image_mode in ("featured_only", "featured_and_top") else "featured_and_top"
    if body.embed_pin_in_article is not None:
        site.embed_pin_in_article = body.embed_pin_in_article
    if body.generate_recipe_json is not None:
        site.generate_recipe_json = body.generate_recipe_json
    if "pin_template_id" in body.model_fields_set:
        site.pin_template_id = body.pin_template_id

    await db.commit()
    row = await db.execute(select(Site).where(Site.id == site_id))
    updated = row.scalar_one()
    return await _site_out(updated, db)


class SitePinTemplatePayload(BaseModel):
    template_id: str | None = None


@router.patch("/api/sites/{site_id}/pin-template", response_model=SiteOut)
async def set_site_pin_template(
    site_id: uuid.UUID,
    body: SitePinTemplatePayload,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    await check_project_access(site.project_id, user, db, require_roles=[ProjectMemberRole.admin])
    site.pin_template_id = body.template_id
    await db.commit()
    row = await db.execute(select(Site).where(Site.id == site_id))
    return await _site_out(row.scalar_one(), db)


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


@router.post("/api/sites/{site_id}/recipe-images", response_model=RecipeImageUploadResponse)
async def upload_recipe_source_image(
    site_id: uuid.UUID,
    file: UploadFile = File(...),
    user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    """Store a recipe source image on this server (not WordPress). Returns a public URL under /uploads/recipes/."""
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site.project_id, user, db)

    raw = await file.read()
    if len(raw) > _RECIPE_IMAGE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 10 MB size limit")
    if len(raw) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    ext = _recipe_image_extension(file, raw)
    recipes_dir = UPLOADS_ROOT / "recipes"
    recipes_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}{ext}"
    dest = recipes_dir / fname
    dest.write_bytes(raw)

    public_url = f"{settings.server_base_url.rstrip('/')}/uploads/recipes/{fname}"
    return RecipeImageUploadResponse(url=public_url)


@router.post("/api/sites/{site_id}/upload-media", response_model=MediaUploadResponse)
@limiter.limit("30/minute")
async def upload_media_to_wordpress(
    request: Request,
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

    _MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
    wp_username, wp_password = get_random_wp_credentials(site)
    file_content = await file.read()
    if len(file_content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 10 MB size limit")
    filename = file.filename or "pin-design.png"
    
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
@limiter.limit("30/minute")
async def upload_from_url_to_wordpress(
    request: Request,
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

    file_content = b""
    content_type = ""
    try:
        timeout = httpx.Timeout(25.0, connect=5.0, read=20.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            async with client.stream("GET", image_url, headers={"User-Agent": "Mozilla/5.0"}) as resp:
                resp.raise_for_status()

                content_type = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                if content_type and (not content_type.startswith("image/") or content_type == "image/svg+xml"):
                    raise HTTPException(status_code=400, detail="Remote URL is not an allowed image type")

                content_length = resp.headers.get("content-length", "").strip()
                if content_length:
                    try:
                        if int(content_length) > _REMOTE_IMAGE_FETCH_MAX_BYTES:
                            raise HTTPException(status_code=413, detail="Remote image exceeds the 10 MB size limit")
                    except ValueError:
                        pass

                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes(_REMOTE_IMAGE_FETCH_CHUNK_SIZE):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > _REMOTE_IMAGE_FETCH_MAX_BYTES:
                        raise HTTPException(status_code=413, detail="Remote image exceeds the 10 MB size limit")
                    chunks.append(chunk)
                file_content = b"".join(chunks)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to fetch remote image")

    if not file_content:
        raise HTTPException(status_code=400, detail="Remote image is empty")

    ext = ".jpg"
    if content_type == "image/png":
        ext = ".png"
    elif content_type == "image/webp":
        ext = ".webp"
    elif content_type == "image/gif":
        ext = ".gif"
    elif "png" in (image_url.lower().split("?")[0] or ""):
        ext = ".png"
    elif "webp" in (image_url.lower().split("?")[0] or ""):
        ext = ".webp"
    elif "gif" in (image_url.lower().split("?")[0] or ""):
        ext = ".gif"
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


@router.get("/api/sites/{site_id}/last-publish-date")
async def get_last_publish_date(
    site_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    """Return the GMT date of the latest post (published or scheduled) on this WordPress site."""
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    await check_project_access(site.project_id, user, db)

    wp_username, wp_password = get_random_wp_credentials(site)
    base = site.wp_url.replace("xmlrpc.php", "").rstrip("/")
    auth = (wp_username, wp_password)
    latest_date: str | None = None
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            for status in ("future", "publish"):
                url = f"{base}/wp-json/wp/v2/posts?orderby=date&order=desc&per_page=1&status={status}"
                r = await client.get(url, auth=auth)
                posts = r.json() if r.status_code == 200 else []
                if isinstance(posts, list) and posts:
                    date_gmt = posts[0].get("date_gmt")
                    if date_gmt and (latest_date is None or date_gmt > latest_date):
                        latest_date = date_gmt
    except Exception:
        pass
    return {"last_publish_date": latest_date}


@router.post("/api/sites/{site_id}/test-connection")
async def test_wp_connection(
    site_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    """Test whether the stored WordPress credentials can authenticate against the REST API."""
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    await check_project_access(site.project_id, user, db)

    wp_username, wp_password = get_random_wp_credentials(site)
    base = site.wp_url.replace("xmlrpc.php", "").rstrip("/")
    url = f"{base}/wp-json/wp/v2/users/me"

    # Mask password for diagnostics: show first 4 chars only
    pwd_hint = (wp_password[:4] + "…") if wp_password and len(wp_password) > 4 else ("(empty)" if not wp_password else wp_password)

    try:
        # follow_redirects=False so we can detect redirect-strips-auth issues
        async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
            r = await client.get(url, auth=(wp_username, wp_password))

        # Redirect detected — auth header was dropped by the redirect
        if r.status_code in (301, 302, 307, 308):
            redirect_to = r.headers.get("location", "(unknown)")
            return {
                "ok": False,
                "message": (
                    f"Redirect {r.status_code} → {redirect_to} — "
                    f"update WordPress URL in site settings to '{redirect_to.rstrip('/wp-json/wp/v2/users/me').rstrip('/')}' "
                    f"so auth is not dropped"
                ),
                "debug": {"url_called": url, "redirect_to": redirect_to, "user": wp_username, "password_hint": pwd_hint},
            }

        if r.status_code == 200:
            data = r.json()
            name = data.get("name") or data.get("slug") or wp_username
            return {"ok": True, "message": f"Connected as {name}", "debug": {"url_called": url, "user": wp_username, "password_hint": pwd_hint}}
        elif r.status_code == 401:
            return {"ok": False, "message": "Wrong credentials (401) — check username / password", "debug": {"url_called": url, "user": wp_username, "password_hint": pwd_hint}}
        elif r.status_code == 403:
            return {"ok": False, "message": "Forbidden (403) — Authorization header is blocked. Add this to .htaccess: RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]", "debug": {"url_called": url, "user": wp_username, "password_hint": pwd_hint}}
        elif r.status_code == 404:
            return {"ok": False, "message": "REST API not found (404) — may be disabled on this site", "debug": {"url_called": url}}
        else:
            return {"ok": False, "message": f"Unexpected response: {r.status_code}", "debug": {"url_called": url, "user": wp_username, "password_hint": pwd_hint}}

    except httpx.ConnectError:
        return {"ok": False, "message": f"Cannot reach {base} — check the WordPress URL", "debug": {"url_called": url}}
    except httpx.TimeoutException:
        return {"ok": False, "message": "Request timed out — site may be slow or unreachable", "debug": {"url_called": url}}
    except Exception as e:
        return {"ok": False, "message": f"Error: {str(e)[:120]}", "debug": {"url_called": url}}
