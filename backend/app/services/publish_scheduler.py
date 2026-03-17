from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.database import SessionLocal
from app.db_models import ProjectPublishSchedule, Recipe, RecipeStatus, Site
from app.services.publisher import publish_recipe
from app.site_credentials import get_random_wp_credentials


async def run_publish_scheduler(stop_event: asyncio.Event) -> None:
    """Background loop: publish one generated recipe per enabled project schedule interval."""
    while not stop_event.is_set():
        now = datetime.now(timezone.utc)
        async with SessionLocal() as db:
            rows = await db.execute(
                select(ProjectPublishSchedule).where(
                    ProjectPublishSchedule.enabled == True,  # noqa: E712
                    ProjectPublishSchedule.next_run_at.isnot(None),
                    ProjectPublishSchedule.next_run_at <= now,
                )
            )
            schedules = rows.scalars().all()
            for s in schedules:
                try:
                    recipe_row = await db.execute(
                        select(Recipe, Site)
                        .join(Site, Recipe.site_id == Site.id)
                        .where(
                            Site.project_id == s.project_id,
                            Recipe.status == RecipeStatus.generated,
                        )
                        .order_by(Recipe.created_at.asc())
                        .limit(1)
                    )
                    pair = recipe_row.first()
                    s.last_run_at = now
                    s.next_run_at = now + timedelta(hours=max(1, s.interval_hours))
                    if not pair:
                        s.last_error = "No generated recipe available to publish"
                        continue

                    recipe, site = pair
                    wp_username, wp_password = get_random_wp_credentials(site)
                    site_config = {
                        "wp_url": site.wp_url,
                        "wp_username": wp_username,
                        "wp_password": wp_password,
                        "domain": site.domain if site.domain.startswith("http") else f"https://{site.domain}",
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
                    result = publish_recipe(recipe_dict, site_config)
                    if result.get("error_message"):
                        recipe.status = RecipeStatus.failed
                        recipe.error_message = result["error_message"]
                        s.last_error = result["error_message"]
                    else:
                        recipe.wp_post_id = result.get("wp_post_id")
                        recipe.wp_permalink = result.get("wp_permalink")
                        recipe.status = RecipeStatus.published
                        recipe.error_message = None
                        s.last_error = None
                except Exception as exc:
                    s.last_run_at = now
                    s.next_run_at = now + timedelta(hours=max(1, s.interval_hours))
                    s.last_error = str(exc)
            await db.commit()

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=30)
        except asyncio.TimeoutError:
            pass
