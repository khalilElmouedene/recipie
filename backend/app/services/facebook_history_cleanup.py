"""Remove local history only after every Facebook Page delivery has published."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, exists, func, select

from app.crypto import decrypt
from app.database import SessionLocal
from app.db_models import (
    FacebookContent, FacebookContentStatus, FacebookDelivery,
    FacebookDeliveryStatus, FacebookGenerationLog, FacebookPage, FacebookSpyRow,
)
from app.services import facebook_api
from app.services.facebook_generation import facebook_generation_manager
from app.services.facebook_publisher import _local_upload_path, delete_facebook_content_files

logger = logging.getLogger(__name__)
CLEANUP_INTERVAL_SECONDS = 60 * 60
TRACKING_START_DELAY = timedelta(days=1)
TRACKING_DURATION = timedelta(days=4)
HISTORY_RETENTION_WINDOW = TRACKING_START_DELAY + TRACKING_DURATION  # 5 days (1d wait + 4d tracking)
STATS_REFRESH_STALE_AFTER = timedelta(hours=1)


def published_history_query(project_id: uuid.UUID | None, before: datetime | None):
    deliveries = select(FacebookDelivery.id).where(
        FacebookDelivery.content_id == FacebookContent.id,
    )
    query = select(FacebookContent.id).where(
        FacebookContent.status == FacebookContentStatus.ready,
        FacebookContent.generation_cancelled.is_(False),
        exists(deliveries),
        ~exists(deliveries.where(FacebookDelivery.status != FacebookDeliveryStatus.published)),
    )
    if project_id is not None:
        query = query.where(FacebookContent.project_id == project_id)
    if before is not None:
        query = query.where(~exists(deliveries.where(
            (FacebookDelivery.published_at.is_(None))
            | (FacebookDelivery.published_at > before),
        )))
    return query.order_by(FacebookContent.created_at, FacebookContent.id)


async def delete_published_history_item(content_id: uuid.UUID, before: datetime | None) -> bool:
    async with SessionLocal() as db:
        content = (await db.execute(
            select(FacebookContent).where(FacebookContent.id == content_id).with_for_update()
        )).scalar_one_or_none()
        if content is None or content.status != FacebookContentStatus.ready:
            return False
        if content.generation_cancelled or facebook_generation_manager.is_running(content_id):
            return False
        deliveries = list((await db.execute(
            select(FacebookDelivery).where(FacebookDelivery.content_id == content_id).with_for_update()
        )).scalars())
        if not deliveries or any(d.status != FacebookDeliveryStatus.published for d in deliveries):
            return False
        if before is not None:
            for delivery in deliveries:
                published_at = delivery.published_at
                if published_at is None:
                    return False
                if published_at.tzinfo is None:
                    published_at = published_at.replace(tzinfo=timezone.utc)
                if published_at > before:
                    return False

        other_references = (await db.execute(
            select(func.count(FacebookContent.id)).where(
                FacebookContent.id != content_id,
                FacebookContent.source_video_url == content.source_video_url,
            )
        )).scalar_one()
        spy_references = (await db.execute(
            select(func.count(FacebookSpyRow.id)).where(
                FacebookSpyRow.direct_link == content.source_video_url,
            )
        )).scalar_one()
        _, _, failures = await asyncio.to_thread(
            delete_facebook_content_files,
            content_id,
            source_video_url=content.source_video_url,
            processed_video_url=content.processed_video_url,
            delete_source=not other_references and not spy_references,
        )
        if failures:
            # Retain the record so the next daily pass can retry failed file removal.
            raise OSError(f"Could not remove local assets for {content_id}: {failures}")
        await db.execute(delete(FacebookGenerationLog).where(FacebookGenerationLog.content_id == content_id))
        await db.execute(delete(FacebookDelivery).where(FacebookDelivery.content_id == content_id))
        await db.delete(content)
        # Keep the linked WordPress recipe: its published article remains accessible.
        await db.commit()
        return True


async def cleanup_published_facebook_history(
    project_id: uuid.UUID | None = None, *, before: datetime | None = None,
) -> dict[str, int]:
    async with SessionLocal() as db:
        content_ids = list((await db.execute(published_history_query(project_id, before))).scalars())
    result = {"deleted": 0, "skipped": 0, "failed": 0}
    for content_id in content_ids:
        try:
            deleted = await delete_published_history_item(content_id, before)
            result["deleted" if deleted else "skipped"] += 1
        except Exception:
            result["failed"] += 1
            logger.exception("Facebook history cleanup failed for %s", content_id)
    return result


async def cleanup_expired_tracked_deliveries(
    project_id: uuid.UUID | None = None, *, before: datetime | None = None,
) -> int:
    """Delete individual published deliveries that have passed the 5-day tracking window
    even if sibling deliveries on the same content are still scheduled or recent."""
    cutoff = before or (datetime.now(timezone.utc) - HISTORY_RETENTION_WINDOW)
    deleted_deliveries = 0
    async with SessionLocal() as db:
        query = (
            select(FacebookDelivery)
            .join(FacebookContent, FacebookContent.id == FacebookDelivery.content_id)
            .where(
                FacebookDelivery.status == FacebookDeliveryStatus.published,
                FacebookDelivery.published_at.is_not(None),
                FacebookDelivery.published_at <= cutoff,
            )
        )
        if project_id is not None:
            query = query.where(FacebookContent.project_id == project_id)
        rows = list((await db.execute(query)).scalars().all())
        for delivery in rows:
            for media_url in (delivery.processed_video_url, delivery.generated_image_url):
                local_path = _local_upload_path(media_url)
                if local_path is not None and local_path.is_file():
                    try:
                        local_path.unlink(missing_ok=True)
                    except OSError:
                        logger.warning("Could not delete expired delivery media %s", local_path)
            await db.delete(delivery)
            deleted_deliveries += 1
        if deleted_deliveries:
            await db.commit()
    return deleted_deliveries


async def refresh_tracked_facebook_stats(
    project_id: uuid.UUID | None = None, *, force: bool = False,
) -> int:
    """Refresh Facebook Graph API metrics for posts in the [1 day, 5 days] tracking window."""
    now = datetime.now(timezone.utc)
    tracking_start_cutoff = now - TRACKING_START_DELAY
    tracking_end_cutoff = now - HISTORY_RETENTION_WINDOW
    stale_cutoff = now - STATS_REFRESH_STALE_AFTER

    async with SessionLocal() as db:
        query = (
            select(FacebookDelivery, FacebookContent, FacebookPage)
            .join(FacebookContent, FacebookContent.id == FacebookDelivery.content_id)
            .join(FacebookPage, FacebookPage.id == FacebookDelivery.page_id)
            .where(
                FacebookDelivery.status == FacebookDeliveryStatus.published,
                FacebookDelivery.published_at.is_not(None),
                FacebookDelivery.published_at <= tracking_start_cutoff,
                FacebookDelivery.published_at > tracking_end_cutoff,
                FacebookContent.generation_cancelled.is_(False),
            )
        )
        if project_id is not None:
            query = query.where(FacebookContent.project_id == project_id)
        rows = (await db.execute(query)).all()

    refreshed = 0
    for delivery, content, page in rows:
        if not delivery.facebook_post_id:
            continue
        checked_at = delivery.stats_checked_at
        if checked_at is not None and checked_at.tzinfo is None:
            checked_at = checked_at.replace(tzinfo=timezone.utc)
        if not force and checked_at is not None and checked_at > stale_cutoff:
            continue
        try:
            page_token = decrypt(page.access_token)
            metrics = await asyncio.to_thread(
                facebook_api.fetch_post_metrics,
                facebook_post_id=delivery.facebook_post_id,
                page_id=page.facebook_page_id,
                page_access_token=page_token,
                post_type=getattr(content, "post_type", "video") or "video",
            )
            async with SessionLocal() as db:
                row = (
                    await db.execute(
                        select(FacebookDelivery).where(FacebookDelivery.id == delivery.id)
                    )
                ).scalar_one_or_none()
                if row is not None:
                    row.views_count = int(metrics.get("views", 0))
                    row.likes_count = int(metrics.get("likes", 0))
                    row.comments_count = int(metrics.get("comments", 0))
                    row.shares_count = int(metrics.get("shares", 0))
                    row.stats_checked_at = datetime.now(timezone.utc)
                    await db.commit()
                    refreshed += 1
        except Exception:
            logger.warning(
                "Could not refresh Facebook stats for delivery %s",
                delivery.id,
                exc_info=True,
            )
    return refreshed


async def run_facebook_history_cleanup(stop_event: asyncio.Event) -> None:
    # Catch up on backend startup, then run hourly; timestamps survive restarts.
    while not stop_event.is_set():
        try:
            cutoff = datetime.now(timezone.utc) - HISTORY_RETENTION_WINDOW
            result = await cleanup_published_facebook_history(
                before=cutoff,
            )
            if result["deleted"] or result["failed"]:
                logger.info("Facebook history cleanup (5-day window): %s", result)
        except Exception:
            logger.exception("Facebook history cleanup could not run")
        if not stop_event.is_set():
            try:
                await cleanup_expired_tracked_deliveries(
                    before=datetime.now(timezone.utc) - HISTORY_RETENTION_WINDOW,
                )
                await refresh_tracked_facebook_stats(force=False)
            except Exception:
                logger.exception("Facebook tracked stats refresh could not run")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=CLEANUP_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass
