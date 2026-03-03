from __future__ import annotations
import csv
import io
import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse, Response
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import User, Site, Recipe, ProjectCredential, RecipeStatus
from ..dependencies import get_current_user, check_project_access
from ..crypto import decrypt
from ..site_credentials import get_random_wp_credentials
from ..models import (
    RecipeCreate, RecipeOut, RecipeUpdate,
    PinterestPinRequest, PinterestBulkResponse,
    PinTemplateOut, GeneratePinRequest, GeneratePinResponse,
    BulkGeneratePinsRequest, BulkGeneratePinsResponse, BulkPinItem,
)

router = APIRouter(tags=["recipes"])


@router.get("/api/sites/{site_id}/recipes", response_model=list[RecipeOut])
async def list_recipes(
    site_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(select(Site).where(Site.id == site_id))
    site = result.scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    await check_project_access(site.project_id, user, db)

    result = await db.execute(
        select(Recipe).where(Recipe.site_id == site_id).order_by(Recipe.created_at.desc())
    )
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
    if body.pin_design_image is not None:
        recipe.pin_design_image = body.pin_design_image
    if body.pin_title is not None:
        recipe.pin_title = body.pin_title
    if body.pin_description is not None:
        recipe.pin_description = body.pin_description
    if body.pin_blog_link is not None:
        recipe.pin_blog_link = body.pin_blog_link

    await db.commit()
    row = await db.execute(select(Recipe).where(Recipe.id == recipe_id))
    return row.scalar_one()


@router.post("/api/recipes/{recipe_id}/pinterest", response_model=PinterestBulkResponse)
async def create_pinterest_pins(
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


@router.post("/api/recipes/{recipe_id}/publish-article", response_model=dict)
async def publish_recipe_article(
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

    if not recipe.generated_article:
        raise HTTPException(status_code=400, detail="No article generated. Generate content first.")

    wp_username, wp_password = get_random_wp_credentials(site_obj)
    site_config = {
        "wp_url": site_obj.wp_url,
        "wp_username": wp_username,
        "wp_password": wp_password,
        "domain": site_obj.domain if site_obj.domain.startswith("http") else f"https://{site_obj.domain}",
    }

    recipe_dict = {
        "id": str(recipe.id),
        "recipe_text": recipe.recipe_text,
        "generated_article": recipe.generated_article,
        "generated_json": recipe.generated_json,
        "focus_keyword": recipe.focus_keyword,
        "meta_description": recipe.meta_description,
        "category": recipe.category,
        "image_url": recipe.image_url,
        "generated_images": recipe.generated_images,
    }

    from ..services.publisher import publish_recipe
    pub_result = publish_recipe(recipe_dict, site_config)

    if "error_message" in pub_result:
        raise HTTPException(status_code=500, detail=pub_result["error_message"])

    recipe.wp_post_id = pub_result.get("wp_post_id")
    recipe.wp_permalink = pub_result.get("wp_permalink")
    recipe.status = RecipeStatus.published
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
    user: Annotated[User, Depends(get_current_user)],
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
