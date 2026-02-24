from __future__ import annotations
import csv
import io
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import User, Site, Recipe
from ..dependencies import get_current_user, check_project_access
from ..models import RecipeCreate, RecipeOut

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
    )
    db.add(recipe)
    await db.commit()
    await db.refresh(recipe)
    return recipe


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

    await db.delete(recipe)
    await db.commit()


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
