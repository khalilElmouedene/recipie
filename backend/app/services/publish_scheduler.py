from __future__ import annotations

import asyncio
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.database import SessionLocal
from app.db_models import Job, JobType, ProjectPublishSchedule, Recipe, RecipeStatus, Site, SitePublishSchedule
from app.services.publisher import publish_recipe
from app.site_credentials import get_random_wp_credentials


def _build_recipe_dict(recipe: Recipe) -> dict:
    return {
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
    }


def _build_site_config(site: Site) -> dict:
    wp_username, wp_password = get_random_wp_credentials(site)
    return {
        "wp_url": site.wp_url,
        "wp_username": wp_username,
        "wp_password": wp_password,
        "domain": site.domain if site.domain.startswith("http") else f"https://{site.domain}",
    }


async def run_publish_scheduler(stop_event: asyncio.Event) -> None:
    """Background loop: publish generated recipes per project/site schedule intervals."""
    while not stop_event.is_set():
        now = datetime.now(timezone.utc)
        async with SessionLocal() as db:
            # ── Per-site schedules (auto_spy_generate recipes) ────────────────
            site_schedule_rows = await db.execute(
                select(SitePublishSchedule).where(
                    SitePublishSchedule.enabled == True,  # noqa: E712
                    SitePublishSchedule.next_run_at.isnot(None),
                    SitePublishSchedule.next_run_at <= now,
                )
            )
            for ss in site_schedule_rows.scalars().all():
                try:
                    recipe_row = await db.execute(
                        select(Recipe, Site)
                        .join(Site, Recipe.site_id == Site.id)
                        .join(Job, Recipe.created_by_job_id == Job.id)
                        .where(
                            Recipe.site_id == ss.site_id,
                            Recipe.status == RecipeStatus.generated,
                            Job.job_type == JobType.auto_spy_generate,
                        )
                        .order_by(Recipe.created_at.asc())
                        .limit(1)
                    )
                    pair = recipe_row.first()
                    # Capture the scheduled time before advancing the pointer
                    publish_at = ss.next_run_at
                    ss.last_run_at = now
                    ss.next_run_at = now + timedelta(minutes=max(1, ss.interval_minutes))
                    if not pair:
                        ss.last_error = "No generated recipe available to publish"
                        continue
                    recipe, site = pair
                    # Use the scheduled time as the WP post date — no backdating.
                    # If publish_at is in the future WP creates it as "Scheduled";
                    # if in the past WP publishes it immediately with that date.
                    result = publish_recipe(_build_recipe_dict(recipe), _build_site_config(site), post_date_gmt=publish_at)
                    if result.get("error_message"):
                        recipe.status = RecipeStatus.failed
                        recipe.error_message = result["error_message"]
                        ss.last_error = result["error_message"]
                    else:
                        recipe.wp_post_id = result.get("wp_post_id")
                        recipe.wp_permalink = result.get("wp_permalink")
                        recipe.status = RecipeStatus.published
                        recipe.error_message = None
                        ss.last_error = None
                except Exception as exc:
                    ss.last_run_at = now
                    ss.next_run_at = now + timedelta(minutes=max(1, ss.interval_minutes))
                    ss.last_error = str(exc)

            # ── Project-level schedules (articles_all_sites + legacy auto_spy) ─
            # Exclude sites that have their own SitePublishSchedule so they are
            # not double-published.
            sites_with_own_schedule = select(SitePublishSchedule.site_id).where(
                SitePublishSchedule.enabled == True  # noqa: E712
            )
            project_schedule_rows = await db.execute(
                select(ProjectPublishSchedule).where(
                    ProjectPublishSchedule.enabled == True,  # noqa: E712
                    ProjectPublishSchedule.next_run_at.isnot(None),
                    ProjectPublishSchedule.next_run_at <= now,
                )
            )
            for s in project_schedule_rows.scalars().all():
                try:
                    recipe_row = await db.execute(
                        select(Recipe, Site)
                        .join(Site, Recipe.site_id == Site.id)
                        .join(Job, Recipe.created_by_job_id == Job.id)
                        .where(
                            Site.project_id == s.project_id,
                            Recipe.status == RecipeStatus.generated,
                            Job.job_type.in_([JobType.articles_all_sites, JobType.auto_spy_generate]),
                            ~Recipe.site_id.in_(sites_with_own_schedule),
                        )
                        .order_by(Recipe.created_at.asc())
                        .limit(1)
                    )
                    pair = recipe_row.first()
                    s.last_run_at = now
                    s.next_run_at = now + timedelta(minutes=max(1, s.interval_minutes))
                    if not pair:
                        s.last_error = "No generated recipe available to publish"
                        continue
                    recipe, site = pair
                    six_months_sec = int(timedelta(days=183).total_seconds())
                    backdate = datetime.now(timezone.utc) - timedelta(seconds=random.randint(1, six_months_sec))
                    result = publish_recipe(_build_recipe_dict(recipe), _build_site_config(site), post_date_gmt=backdate)
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
                    s.next_run_at = now + timedelta(minutes=max(1, s.interval_minutes))
                    s.last_error = str(exc)

            await db.commit()

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=10)
        except asyncio.TimeoutError:
            pass
