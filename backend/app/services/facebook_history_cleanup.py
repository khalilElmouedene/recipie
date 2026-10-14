"""Remove local history only after every Facebook Page delivery has published."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, exists, func, select

from app.database import SessionLocal
from app.db_models import (
    FacebookContent, FacebookContentStatus, FacebookDelivery,
    FacebookDeliveryStatus, FacebookGenerationLog, FacebookSpyRow,
)
from app.services.facebook_generation import facebook_generation_manager
from app.services.facebook_publisher import delete_facebook_content_files

logger = logging.getLogger(__name__)
CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60


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


async def run_facebook_history_cleanup(stop_event: asyncio.Event) -> None:
    # Catch up on backend startup, then run daily; timestamps survive restarts.
    while not stop_event.is_set():
        try:
            result = await cleanup_published_facebook_history(
                before=datetime.now(timezone.utc) - timedelta(hours=24),
            )
            if result["deleted"] or result["failed"]:
                logger.info("Facebook daily history cleanup: %s", result)
        except Exception:
            logger.exception("Facebook daily history cleanup could not run")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=CLEANUP_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass
