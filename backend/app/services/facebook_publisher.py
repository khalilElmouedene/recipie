from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.config import settings
from app.crypto import decrypt
from app.database import SessionLocal
from app.db_models import (
    FacebookCommentMode,
    FacebookContent,
    FacebookDelivery,
    FacebookDeliveryStatus,
    FacebookPage,
    FacebookProject,
    Recipe,
    RecipeStatus,
    Site,
)
from app.services import facebook_api
from app.services.publisher import publish_recipe
from app.site_credentials import get_random_wp_credentials

logger = logging.getLogger(__name__)
_content_locks: dict[uuid.UUID, asyncio.Lock] = {}
_content_locks_guard = asyncio.Lock()


def build_first_comment(mode: FacebookCommentMode | str, article_url: str) -> str:
    value = mode.value if hasattr(mode, "value") else str(mode)
    if value == FacebookCommentMode.full_recipe_url.value:
        return f"Full Recipe\n{article_url}"
    return "Full Recipe"


def _absolute_media_url(url: str) -> str:
    if not url:
        return url
    if "/uploads/" in url:
        suffix = url.split("/uploads/", 1)[1]
        return f"{settings.server_base_url.rstrip('/')}/uploads/{suffix}"
    if url.startswith("/"):
        return settings.server_base_url.rstrip("/") + url
    return url


async def _content_lock(content_id: uuid.UUID) -> asyncio.Lock:
    async with _content_locks_guard:
        return _content_locks.setdefault(content_id, asyncio.Lock())


async def _ensure_article_published(content_id: uuid.UUID) -> str:
    lock = await _content_lock(content_id)
    async with lock:
        async with SessionLocal() as db:
            row = await db.execute(
                select(FacebookContent, FacebookProject, Recipe, Site)
                .join(FacebookProject, FacebookProject.id == FacebookContent.project_id)
                .join(Recipe, Recipe.id == FacebookContent.recipe_id)
                .join(Site, Site.id == Recipe.site_id)
                .where(FacebookContent.id == content_id)
            )
            record = row.one_or_none()
            if record is None:
                raise ValueError("Generated Facebook content or website was not found.")
            content, _project, recipe, site = record
            if content.article_url:
                return content.article_url
            if recipe.wp_permalink:
                content.article_url = recipe.wp_permalink
                await db.commit()
                return recipe.wp_permalink
            username, password = get_random_wp_credentials(site)
            site_config = {
                "id": str(site.id),
                "domain": site.domain,
                "wp_url": site.wp_url,
                "wp_username": username,
                "wp_password": password,
                "image_mode": getattr(site, "image_mode", "featured_and_top"),
                "embed_pin_in_article": bool(getattr(site, "embed_pin_in_article", False)),
            }
            recipe_payload = {
                "id": str(recipe.id),
                "recipe_text": recipe.recipe_text or "",
                "image_url": recipe.image_url or "",
                "generated_article": recipe.generated_article or "",
                "generated_json": recipe.generated_json or "",
                "focus_keyword": recipe.focus_keyword or "",
                "meta_description": recipe.meta_description or "",
                "category": recipe.category or "",
                "generated_images": recipe.generated_images or "",
                "seo_title": recipe.seo_title or "",
                "wp_tags": recipe.wp_tags or "",
                "pin_design_image": recipe.pin_design_image or "",
            }

        result = await asyncio.to_thread(
            publish_recipe,
            recipe_payload,
            site_config,
            lambda message: logger.info(
                "[facebook-wordpress:%s] %s", content_id, str(message)[:1000]
            ),
        )
        article_url = result.get("wp_permalink")
        if not article_url:
            raise ValueError(result.get("error_message") or "WordPress did not return an article URL.")

        async with SessionLocal() as db:
            content = (
                await db.execute(
                    select(FacebookContent).where(FacebookContent.id == content_id)
                )
            ).scalar_one()
            recipe = (
                await db.execute(select(Recipe).where(Recipe.id == content.recipe_id))
            ).scalar_one()
            content.article_url = article_url
            recipe.wp_permalink = article_url
            recipe.wp_post_id = result.get("wp_post_id")
            recipe.status = RecipeStatus.published
            recipe.error_message = None
            await db.commit()
        return article_url


async def publish_facebook_delivery(delivery_id: uuid.UUID) -> bool:
    async with SessionLocal() as db:
        claimed = await db.execute(
            update(FacebookDelivery)
            .where(
                FacebookDelivery.id == delivery_id,
                FacebookDelivery.status.in_(
                    [
                        FacebookDeliveryStatus.draft,
                        FacebookDeliveryStatus.scheduled,
                        FacebookDeliveryStatus.failed,
                    ]
                ),
            )
            .values(status=FacebookDeliveryStatus.publishing, error_message=None)
            .returning(FacebookDelivery.id)
        )
        if claimed.scalar_one_or_none() is None:
            await db.rollback()
            return False
        await db.commit()

    try:
        async with SessionLocal() as db:
            row = await db.execute(
                select(FacebookDelivery, FacebookContent, FacebookPage)
                .join(FacebookContent, FacebookContent.id == FacebookDelivery.content_id)
                .join(FacebookPage, FacebookPage.id == FacebookDelivery.page_id)
                .where(FacebookDelivery.id == delivery_id)
            )
            delivery, content, page = row.one()
            if not content.processed_video_url:
                raise ValueError("Processed video is not ready.")
            page_token = decrypt(page.access_token)
            page_id = page.facebook_page_id
            page_mode = page.comment_mode
            title = content.title
            video_url = _absolute_media_url(content.processed_video_url)
            content_id = content.id
            existing_post_id = delivery.facebook_post_id
            existing_comment_id = delivery.first_comment_id

        article_url = await _ensure_article_published(content_id)
        post_id = existing_post_id
        if not post_id:
            post_id = await asyncio.to_thread(
                facebook_api.publish_video,
                page_id=page_id,
                page_access_token=page_token,
                video_url=video_url,
                title=title,
                description=title,
            )
            # Persist immediately so a first-comment failure can be retried
            # without publishing a duplicate main video.
            async with SessionLocal() as db:
                await db.execute(
                    update(FacebookDelivery)
                    .where(FacebookDelivery.id == delivery_id)
                    .values(facebook_post_id=post_id)
                )
                await db.commit()
        comment_id = existing_comment_id
        if not comment_id:
            comment_id = await asyncio.to_thread(
                facebook_api.add_first_comment,
                post_id=post_id,
                page_access_token=page_token,
                message=build_first_comment(page_mode, article_url),
            )
        async with SessionLocal() as db:
            await db.execute(
                update(FacebookDelivery)
                .where(FacebookDelivery.id == delivery_id)
                .values(
                    status=FacebookDeliveryStatus.published,
                    published_at=datetime.now(timezone.utc),
                    facebook_post_id=post_id,
                    first_comment_id=comment_id,
                    error_message=None,
                )
            )
            await db.commit()
        return True
    except Exception as exc:
        logger.exception("Facebook delivery %s failed", delivery_id)
        async with SessionLocal() as db:
            await db.execute(
                update(FacebookDelivery)
                .where(FacebookDelivery.id == delivery_id)
                .values(
                    status=FacebookDeliveryStatus.failed,
                    error_message=str(exc)[:2000],
                )
            )
            await db.commit()
        return False


async def run_facebook_scheduler(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        now = datetime.now(timezone.utc)
        async with SessionLocal() as db:
            rows = await db.execute(
                select(FacebookDelivery.id)
                .where(
                    FacebookDelivery.status == FacebookDeliveryStatus.scheduled,
                    FacebookDelivery.scheduled_at.is_not(None),
                    FacebookDelivery.scheduled_at <= now,
                )
                .order_by(FacebookDelivery.scheduled_at.asc())
                .limit(20)
            )
            due_ids = list(rows.scalars().all())
        for delivery_id in due_ids:
            await publish_facebook_delivery(delivery_id)
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=30)
        except asyncio.TimeoutError:
            pass
