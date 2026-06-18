from __future__ import annotations
import asyncio
import csv
import functools
import io
import json
import logging
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

import requests as _requests
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import case, func, select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import User, Site, Recipe, ProjectCredential, RecipeStatus
from ..dependencies import get_current_user, get_current_user_download, check_project_access
from ..crypto import decrypt
from ..site_credentials import get_random_wp_credentials
from ..pagination import apply_limit_offset, count_rows, set_total_count
from ..models import (
    RecipeCreate, RecipeOut, RecipeUpdate,
    PinterestPinRequest, PinterestBulkResponse,
    PinTemplateOut, GeneratePinRequest, GeneratePinResponse,
    BulkGeneratePinsRequest, BulkGeneratePinsResponse, BulkPinItem,
    SiteRecipeCardOut, SiteRecipeCardPageOut,
)

router = APIRouter(tags=["recipes"])
limiter = Limiter(key_func=get_remote_address)
logger = logging.getLogger(__name__)
_IMAGE_PROXY_MAX_BYTES = 10 * 1024 * 1024
_IMAGE_PROXY_CHUNK_SIZE = 64 * 1024


def _recipe_card_title(recipe_text: str | None) -> str:
    return (recipe_text or "").split("\n", 1)[0].strip()


def _recipe_card_image_url(image_url: str | None, generated_images: str | None) -> str | None:
    if generated_images:
        try:
            parsed = json.loads(generated_images)
            if isinstance(parsed, list) and parsed:
                first = parsed[0]
                if isinstance(first, str) and first.strip():
                    return first.strip()
        except Exception:
            pass
    return image_url or None


def _is_safe_url(url: str) -> bool:
    """Return True only for public http/https URLs.

    Blocks private, loopback, link-local, and reserved addresses for both
    IPv4 and IPv6 to prevent SSRF.  Note: DNS rebinding is a known residual
    risk with any pre-flight check; combine with egress firewall rules in prod.
    """
    import ipaddress
    import socket
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    host = parsed.hostname or ""
    if not host:
        return False
    # Reject bare IP literals that are non-public before DNS resolution
    try:
        addr = ipaddress.ip_address(host)
        if not addr.is_global:
            return False
        return True
    except ValueError:
        pass  # not an IP literal — proceed to DNS resolution

    try:
        # getaddrinfo returns all A/AAAA records; block if any resolve to non-public
        infos = socket.getaddrinfo(host, None)
        if not infos:
            return False
        for ai in infos:
            ip_str = ai[4][0]
            addr = ipaddress.ip_address(ip_str)
            if not addr.is_global:
                return False
    except Exception:
        return False  # Fail safe: unresolvable host is blocked
    return True


@router.get("/api/image-proxy")
@limiter.limit("60/minute")
def image_proxy(
    request: Request,
    url: str = Query(...),
    _user: Annotated[User, Depends(get_current_user_download)] = None,
):
    """Proxy external images (e.g. Discord CDN) to avoid browser CORS restrictions."""
    if not _is_safe_url(url):
        raise HTTPException(status_code=400, detail="URL not allowed")
    try:
        r = _requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=(5, 20),
            stream=True,
            allow_redirects=True,
        )
        r.raise_for_status()
        media_type = r.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        if not media_type.startswith("image/") or media_type == "image/svg+xml":
            raise HTTPException(status_code=400, detail="URL is not an allowed image type")

        content_length = r.headers.get("content-length", "").strip()
        if content_length:
            try:
                if int(content_length) > _IMAGE_PROXY_MAX_BYTES:
                    raise HTTPException(status_code=413, detail="Image exceeds the 10 MB size limit")
            except ValueError:
                pass

        data = bytearray()
        for chunk in r.iter_content(chunk_size=_IMAGE_PROXY_CHUNK_SIZE):
            if not chunk:
                continue
            data.extend(chunk)
            if len(data) > _IMAGE_PROXY_MAX_BYTES:
                raise HTTPException(status_code=413, detail="Image exceeds the 10 MB size limit")

        return Response(
            content=bytes(data),
            media_type=media_type,
            headers={"Cache-Control": "private, max-age=300"},
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="Image not available")


@router.get("/api/sites/{site_id}/recipe-cards", response_model=SiteRecipeCardPageOut)
async def list_recipe_cards(
    site_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int | None = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site.project_id, user, db)

    stats_stmt = select(
        func.count(Recipe.id).label("total"),
        func.sum(case((Recipe.status == RecipeStatus.pending, 1), else_=0)).label("pending"),
        func.sum(case((Recipe.status == RecipeStatus.generating, 1), else_=0)).label("generating"),
        func.sum(case((Recipe.status == RecipeStatus.generated, 1), else_=0)).label("generated"),
        func.sum(case((Recipe.status == RecipeStatus.published, 1), else_=0)).label("published"),
        func.sum(case((Recipe.status == RecipeStatus.failed, 1), else_=0)).label("failed"),
        func.sum(case((Recipe.generated_images.is_not(None), 1), else_=0)).label("with_generated_images"),
    ).where(Recipe.site_id == site_id)
    stats_row = (await db.execute(stats_stmt)).one()

    items_stmt = (
        select(
            Recipe.id,
            Recipe.recipe_text,
            Recipe.image_url,
            Recipe.generated_images,
            Recipe.status,
            Recipe.focus_keyword,
            Recipe.category,
            Recipe.wp_permalink,
            Recipe.error_message,
        )
        .where(Recipe.site_id == site_id)
        .order_by(Recipe.created_at.desc())
    )
    rows = await db.execute(apply_limit_offset(items_stmt, limit, offset))

    items = [
        SiteRecipeCardOut(
            id=row.id,
            title=_recipe_card_title(row.recipe_text),
            list_image_url=_recipe_card_image_url(row.image_url, row.generated_images),
            status=row.status.value if hasattr(row.status, "value") else str(row.status),
            has_generated_images=bool(row.generated_images),
            focus_keyword=row.focus_keyword,
            category=row.category,
            wp_permalink=row.wp_permalink,
            error_message=row.error_message,
        )
        for row in rows
    ]

    return SiteRecipeCardPageOut(
        total=int(stats_row.total or 0),
        pending=int(stats_row.pending or 0),
        generating=int(stats_row.generating or 0),
        generated=int(stats_row.generated or 0),
        published=int(stats_row.published or 0),
        failed=int(stats_row.failed or 0),
        with_generated_images=int(stats_row.with_generated_images or 0),
        items=items,
    )


@router.get("/api/sites/{site_id}/recipes", response_model=list[RecipeOut])
async def list_recipes(
    response: Response,
    site_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    summary: bool = Query(default=False, description="Return lightweight rows without heavy generated text fields"),
    pin_designer: bool = Query(default=False, description="Return only the 8 fields needed by the pin designer"),
    limit: int | None = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site.project_id, user, db)

    if pin_designer:
        stmt = (
            select(
                Recipe.id,
                Recipe.site_id,
                Recipe.created_by,
                Recipe.image_url,
                Recipe.recipe_text,
                Recipe.status,
                Recipe.generated_images,
                Recipe.pin_design_image,
                Recipe.pin_template_id,
                Recipe.pin_title,
                Recipe.pin_description,
                Recipe.created_at,
            )
            .where(Recipe.site_id == site_id)
            .order_by(Recipe.created_at.desc())
        )
        total = await count_rows(db, stmt)
        set_total_count(response, total)
        rows = await db.execute(apply_limit_offset(stmt, limit, offset))
        return [
            {
                "id": row.id,
                "site_id": row.site_id,
                "created_by": row.created_by,
                "image_url": row.image_url,
                "recipe_text": row.recipe_text,
                "status": row.status.value if hasattr(row.status, "value") else row.status,
                "generated_images": row.generated_images,
                "pin_design_image": row.pin_design_image,
                "pin_template_id": row.pin_template_id,
                "pin_title": row.pin_title,
                "pin_description": row.pin_description,
                "created_at": row.created_at,
            }
            for row in rows
        ]

    if summary:
        stmt = (
            select(
                Recipe.id,
                Recipe.site_id,
                Recipe.created_by,
                Recipe.image_url,
                Recipe.recipe_text,
                Recipe.status,
                Recipe.focus_keyword,
                Recipe.category,
                Recipe.generated_images,
                Recipe.wp_post_id,
                Recipe.wp_permalink,
                Recipe.pin_design_image,
                Recipe.pin_title,
                Recipe.pin_description,
                Recipe.pin_blog_link,
                Recipe.pin_template_id,
                Recipe.error_message,
                Recipe.created_at,
            )
            .where(Recipe.site_id == site_id)
            .order_by(Recipe.created_at.desc())
        )
        total = await count_rows(db, stmt)
        set_total_count(response, total)
        rows = await db.execute(apply_limit_offset(stmt, limit, offset))
        out: list[dict] = []
        for row in rows:
            out.append({
                "id": row.id,
                "site_id": row.site_id,
                "created_by": row.created_by,
                "image_url": row.image_url,
                "recipe_text": row.recipe_text,
                "status": row.status.value if hasattr(row.status, "value") else row.status,
                "focus_keyword": row.focus_keyword,
                "category": row.category,
                "generated_images": row.generated_images,
                "wp_post_id": row.wp_post_id,
                "wp_permalink": row.wp_permalink,
                "pin_design_image": row.pin_design_image,
                "pin_title": row.pin_title,
                "pin_description": row.pin_description,
                "pin_blog_link": row.pin_blog_link,
                "pin_template_id": row.pin_template_id,
                "error_message": row.error_message,
                "created_at": row.created_at,
            })
        return out

    stmt = select(Recipe).where(Recipe.site_id == site_id).order_by(Recipe.created_at.desc())
    total = await count_rows(db, stmt)
    set_total_count(response, total)
    result = await db.execute(apply_limit_offset(stmt, limit, offset))
    return result.scalars().all()


@router.get("/api/recipes/{recipe_id}", response_model=RecipeOut)
async def get_recipe(
    recipe_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Recipe).where(Recipe.id == recipe_id))
    recipe = result.scalar_one_or_none()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    site = await db.execute(select(Site).where(Site.id == recipe.site_id))
    site_obj = site.scalar_one_or_none()
    if site_obj:
        await check_project_access(site_obj.project_id, user, db)

    return recipe


@router.post("/api/sites/{site_id}/recipes", response_model=RecipeOut, status_code=status.HTTP_201_CREATED)
async def create_recipe(
    site_id: uuid.UUID,
    body: RecipeCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site.project_id, user, db)

    recipe = Recipe(
        site_id=site_id,
        created_by=user.id,
        image_url=body.image_url,
        recipe_text=body.recipe_text,
        status=RecipeStatus.pending,
    )
    db.add(recipe)
    await db.commit()
    created = await db.execute(select(Recipe).where(Recipe.id == recipe.id))
    return created.scalar_one_or_none() or recipe


@router.patch("/api/recipes/{recipe_id}", response_model=RecipeOut)
async def update_recipe(
    recipe_id: uuid.UUID,
    body: RecipeUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Recipe).where(Recipe.id == recipe_id))
    recipe = result.scalar_one_or_none()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    site = await db.execute(select(Site).where(Site.id == recipe.site_id))
    site_obj = site.scalar_one_or_none()
    if site_obj:
        await check_project_access(site_obj.project_id, user, db)

    if body.recipe_text is not None:
        recipe.recipe_text = body.recipe_text
    if body.generated_images is not None:
        recipe.generated_images = body.generated_images
    if body.generated_article is not None:
        recipe.generated_article = body.generated_article
    if body.pin_design_image is not None:
        recipe.pin_design_image = body.pin_design_image
    if body.pin_title is not None:
        recipe.pin_title = body.pin_title
    if body.pin_description is not None:
        recipe.pin_description = body.pin_description
    if body.pin_blog_link is not None:
        recipe.pin_blog_link = body.pin_blog_link
    if body.pin_template_id is not None:
        recipe.pin_template_id = body.pin_template_id
    if body.pin_url is not None:
        recipe.pin_url = body.pin_url
    if body.pin_board is not None:
        recipe.pin_board = body.pin_board
    if body.pin_tags is not None:
        recipe.pin_tags = body.pin_tags
    if body.seo_title is not None:
        recipe.seo_title = body.seo_title
    if body.wp_tags is not None:
        recipe.wp_tags = body.wp_tags

    await db.commit()
    row = await db.execute(select(Recipe).where(Recipe.id == recipe_id))
    return row.scalar_one()


@router.post("/api/recipes/{recipe_id}/pinterest", response_model=PinterestBulkResponse)
@limiter.limit("20/minute")
async def create_pinterest_pins(
    request: Request,
    recipe_id: uuid.UUID,
    body: PinterestPinRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Recipe).where(Recipe.id == recipe_id))
    recipe = result.scalar_one_or_none()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    site_result = await db.execute(select(Site).where(Site.id == recipe.site_id))
    site_obj = site_result.scalar_one_or_none()
    if not site_obj:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site_obj.project_id, user, db)

    if not recipe.generated_images:
        raise HTTPException(status_code=400, detail="No generated images available for this recipe")

    try:
        all_images = json.loads(recipe.generated_images)
    except (json.JSONDecodeError, TypeError):
        raise HTTPException(status_code=400, detail="Could not parse generated images")

    if not all_images or not isinstance(all_images, list):
        raise HTTPException(status_code=400, detail="No images found")

    if body.image_indices:
        images = [all_images[i] for i in body.image_indices if 0 <= i < len(all_images)]
    else:
        images = all_images

    cred_rows = await db.execute(
        select(ProjectCredential).where(ProjectCredential.project_id == site_obj.project_id)
    )
    credentials: dict[str, str] = {}
    for c in cred_rows.scalars().all():
        try:
            credentials[c.key_type] = decrypt(c.encrypted_value)
        except Exception:
            pass

    pinterest_token = credentials.get("pinterest_token", "")
    if not pinterest_token:
        raise HTTPException(
            status_code=400,
            detail="Pinterest access token not configured. Go to project Credentials and add 'pinterest_token'.",
        )

    recipe_title = (recipe.recipe_text or "").split("\n")[0].strip()
    pin_title = body.title or recipe_title
    pin_description = body.description or recipe.meta_description or recipe_title
    pin_link = body.link or recipe.wp_permalink or ""

    from ..services.pinterest import create_pins_bulk
    result = create_pins_bulk(
        access_token=pinterest_token,
        board_id=body.board_id,
        images=images,
        title=pin_title,
        description=pin_description,
        link=pin_link,
    )
    return result


@router.delete("/api/recipes/{recipe_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recipe(
    recipe_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Recipe).where(Recipe.id == recipe_id))
    recipe = result.scalar_one_or_none()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    site = await db.execute(select(Site).where(Site.id == recipe.site_id))
    site_obj = site.scalar_one_or_none()
    if site_obj:
        await check_project_access(site_obj.project_id, user, db)

    await db.execute(sql_delete(Recipe).where(Recipe.id == recipe_id))
    await db.commit()


@router.delete("/api/sites/{site_id}/recipes", status_code=status.HTTP_204_NO_CONTENT)
async def delete_all_site_recipes(
    site_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    recipe_status: str | None = Query(None, alias="status"),
):
    """Bulk-delete all recipes for a site, optionally filtered by status."""
    site_result = await db.execute(select(Site).where(Site.id == site_id))
    site_obj = site_result.scalar_one_or_none()
    if not site_obj:
        raise HTTPException(status_code=404, detail="Site not found")
    await check_project_access(site_obj.project_id, user, db)

    stmt = sql_delete(Recipe).where(Recipe.site_id == site_id)
    if recipe_status:
        try:
            stmt = stmt.where(Recipe.status == RecipeStatus(recipe_status))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid status: {recipe_status}")
    await db.execute(stmt)
    await db.commit()


@router.post("/api/recipes/{recipe_id}/publish-article", response_model=dict)
@limiter.limit("10/minute")
async def publish_recipe_article(
    request: Request,
    recipe_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Publish a single recipe's full article to WordPress (same as publisher job)."""
    result = await db.execute(select(Recipe).where(Recipe.id == recipe_id))
    recipe = result.scalar_one_or_none()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    site_result = await db.execute(select(Site).where(Site.id == recipe.site_id))
    site_obj = site_result.scalar_one_or_none()
    if not site_obj:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site_obj.project_id, user, db)

    if recipe.status == RecipeStatus.generating:
        raise HTTPException(
            status_code=409,
            detail="This recipe is currently being generated. Wait for generation to complete before publishing.",
        )

    if not recipe.generated_article:
        raise HTTPException(status_code=400, detail="No article generated. Generate content first.")

    wp_username, wp_password = get_random_wp_credentials(site_obj)
    site_config = {
        "wp_url": site_obj.wp_url,
        "wp_username": wp_username,
        "wp_password": wp_password,
        "domain": site_obj.domain if site_obj.domain.startswith("http") else f"https://{site_obj.domain}",
        "image_mode": getattr(site_obj, "image_mode", "featured_and_top") or "featured_and_top",
        "embed_pin_in_article": bool(getattr(site_obj, "embed_pin_in_article", False)),
    }

    recipe_dict = {
        "id": str(recipe.id),
        "recipe_text": recipe.recipe_text,
        "pin_title": recipe.pin_title,
        "generated_article": recipe.generated_article,
        "generated_json": recipe.generated_json,
        "focus_keyword": recipe.focus_keyword,
        "meta_description": recipe.meta_description,
        "category": recipe.category,
        "image_url": recipe.image_url,
        "generated_images": recipe.generated_images,
        "pin_design_image": recipe.pin_design_image,
        "seo_title": recipe.seo_title,
        "wp_tags": recipe.wp_tags,
    }

    from ..services.publisher import publish_recipe
    six_months_sec = int(timedelta(days=183).total_seconds())
    backdate = datetime.now(timezone.utc) - timedelta(seconds=random.randint(1, six_months_sec))
    loop = asyncio.get_event_loop()
    pub_result = await loop.run_in_executor(
        None,
        functools.partial(publish_recipe, recipe_dict, site_config, post_date_gmt=backdate),
    )

    if not pub_result.get("wp_post_id"):
        raw_error = pub_result.get("error_message")
        if raw_error:
            logger.warning(
                "WordPress publish failed for recipe %s: %s",
                recipe_id,
                str(raw_error)[:500],
            )
        raise HTTPException(
            status_code=500,
            detail="Failed to publish article to WordPress",
        )

    recipe.wp_post_id = pub_result.get("wp_post_id")
    recipe.wp_permalink = pub_result.get("wp_permalink")
    recipe.status = RecipeStatus.published
    # Auto-set pin_blog_link to the published post URL so Pinterest pins always
    # link to the correct article (same behaviour as Articles_Publishing_Winsome.py
    # which saves the permalink back to the sheet for Pinterest use).
    if recipe.wp_permalink and not recipe.pin_blog_link:
        recipe.pin_blog_link = recipe.wp_permalink
    await db.commit()

    return {"wp_post_id": recipe.wp_post_id, "wp_permalink": recipe.wp_permalink}


@router.get("/api/pin-templates", response_model=list[PinTemplateOut])
async def get_pin_templates():
    from ..services.pin_generator import list_templates
    return list_templates()


@router.post("/api/recipes/{recipe_id}/generate-pin", response_model=GeneratePinResponse)
async def generate_pin_image(
    recipe_id: uuid.UUID,
    body: GeneratePinRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Recipe).where(Recipe.id == recipe_id))
    recipe = result.scalar_one_or_none()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")

    site_result = await db.execute(select(Site).where(Site.id == recipe.site_id))
    site_obj = site_result.scalar_one_or_none()
    if site_obj:
        await check_project_access(site_obj.project_id, user, db)

    all_images: list[str] = []
    if recipe.generated_images:
        try:
            all_images = json.loads(recipe.generated_images)
        except Exception:
            pass
    if not all_images:
        raise HTTPException(status_code=400, detail="No generated images available")

    if body.image_indices:
        selected = [all_images[i] for i in body.image_indices if 0 <= i < len(all_images)]
    else:
        selected = all_images

    recipe_title = (recipe.recipe_text or "").split("\n")[0].strip()
    title = body.title or recipe_title
    website = body.website or (site_obj.domain if site_obj else "")

    from ..services.pin_generator import extract_ingredients, generate_pin_base64
    ingredients = body.ingredients
    if ingredients is None:
        ingredients = extract_ingredients(recipe.generated_json, recipe.generated_full_recipe)

    b64 = generate_pin_base64(
        template_id=body.template_id,
        image_urls=selected,
        title=title,
        ingredients=ingredients,
        website=website,
    )
    return GeneratePinResponse(image_base64=b64)


@router.post(
    "/api/sites/{site_id}/bulk-generate-pins",
    response_model=BulkGeneratePinsResponse,
)
async def bulk_generate_pins(
    site_id: uuid.UUID,
    body: BulkGeneratePinsRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    site_result = await db.execute(select(Site).where(Site.id == site_id))
    site_obj = site_result.scalar_one_or_none()
    if not site_obj:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site_obj.project_id, user, db)

    recipe_rows = await db.execute(
        select(Recipe)
        .where(Recipe.site_id == site_id, Recipe.generated_images.isnot(None))
        .order_by(Recipe.created_at.asc())
        .limit(50)
    )
    recipes = recipe_rows.scalars().all()
    if not recipes:
        raise HTTPException(status_code=400, detail="No recipes with generated images found")

    from ..services.pin_generator import extract_ingredients, generate_pin_base64

    website = body.website or site_obj.domain
    pins: list[BulkPinItem] = []
    generated = 0
    failed = 0

    for r in recipes:
        recipe_title = (r.recipe_text or "").split("\n")[0].strip()
        try:
            imgs = json.loads(r.generated_images) if r.generated_images else []
        except Exception:
            imgs = []

        if not imgs:
            pins.append(BulkPinItem(
                recipe_id=str(r.id), recipe_title=recipe_title,
                error="No images",
            ))
            failed += 1
            continue

        try:
            ingredients = extract_ingredients(r.generated_json, r.generated_full_recipe)
            b64 = generate_pin_base64(
                template_id=body.template_id,
                image_urls=imgs,
                title=recipe_title,
                ingredients=ingredients,
                website=website,
            )
            pins.append(BulkPinItem(
                recipe_id=str(r.id), recipe_title=recipe_title,
                image_base64=b64,
            ))
            generated += 1
        except Exception as e:
            pins.append(BulkPinItem(
                recipe_id=str(r.id), recipe_title=recipe_title,
                error=str(e),
            ))
            failed += 1

    return BulkGeneratePinsResponse(
        total=len(recipes), generated=generated, failed=failed, pins=pins,
    )


@router.get("/api/projects/{project_id}/pinterest/boards")
async def list_pinterest_boards(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db)

    cred_rows = await db.execute(
        select(ProjectCredential).where(ProjectCredential.project_id == project_id)
    )
    credentials: dict[str, str] = {}
    for c in cred_rows.scalars().all():
        try:
            credentials[c.key_type] = decrypt(c.encrypted_value)
        except Exception:
            pass

    pinterest_token = credentials.get("pinterest_token", "")
    if not pinterest_token:
        raise HTTPException(
            status_code=400,
            detail="Pinterest access token not configured",
        )

    from ..services.pinterest import get_boards
    boards = get_boards(pinterest_token)
    return boards


@router.get("/api/sites/{site_id}/export/excel")
async def export_site_excel(
    site_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Export all recipes for a single site as Excel, same structure as V1 Project."""
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site.project_id, user, db)

    recipes_row = await db.execute(
        select(Recipe).where(Recipe.site_id == site_id).order_by(Recipe.created_at.asc())
    )
    recipes = recipes_row.scalars().all()

    from ..services.excel_export import build_site_excel
    xlsx_bytes = build_site_excel(site, list(recipes))

    domain = site.domain.replace("https://", "").replace("http://", "").rstrip("/")
    filename = f"{domain}.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/sites/{site_id}/recipes/export")
async def export_recipes_csv(
    site_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user_download)],
):
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site.project_id, user, db)

    result = await db.execute(
        select(Recipe).where(Recipe.site_id == site_id).order_by(Recipe.created_at.asc())
    )
    recipes = result.scalars().all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([
        "Image URL", "Recipe Text", "Status", "Focus Keyword",
        "Category", "Meta Description", "Generated Article",
        "Recipe JSON", "Generated Images", "WP Post ID", "WP Permalink",
    ])
    for r in recipes:
        writer.writerow([
            r.image_url, r.recipe_text, r.status.value if r.status else "",
            r.focus_keyword or "", r.category or "", r.meta_description or "",
            r.generated_article or "", r.generated_json or "",
            r.generated_images or "", r.wp_post_id or "", r.wp_permalink or "",
        ])

    buf.seek(0)
    filename = f"{site.domain}_recipes.csv"
    return StreamingResponse(
        buf,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
