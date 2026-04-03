from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.db_models import ThreadsPost, ThreadsPostStatus
from app.services.cloudinary_utils import delete_cloudinary_media

_RETENTION_DAYS = 7


async def run_threads_media_cleanup_scheduler(stop_event: asyncio.Event) -> None:
    """Daily cleanup: delete Cloudinary media for posts published more than 7 days ago."""
    while not stop_event.is_set():
        if settings.cloudinary_cloud_name:
            cutoff = datetime.now(timezone.utc) - timedelta(days=_RETENTION_DAYS)
            async with SessionLocal() as db:
                rows = await db.execute(
                    select(ThreadsPost).where(
                        ThreadsPost.status == ThreadsPostStatus.published,
                        ThreadsPost.published_at <= cutoff,
                        # Only posts that still have media stored
                        ThreadsPost.media_urls.isnot(None),
                    )
                )
                posts = rows.scalars().all()

                for post in posts:
                    try:
                        media: list[str] = json.loads(post.media_urls) if post.media_urls else []
                        if post.image_url:
                            media.append(post.image_url)
                        cloudinary_urls = [u for u in media if u and "res.cloudinary.com" in u]
                        if cloudinary_urls:
                            delete_cloudinary_media(
                                cloudinary_urls,
                                settings.cloudinary_cloud_name,
                                settings.cloudinary_api_key,
                                settings.cloudinary_api_secret,
                            )
                            print(f"[threads_cleanup] deleted {len(cloudinary_urls)} media file(s) for post {post.id}", flush=True)
                        # Clear the stored URLs so we don't retry
                        post.media_urls = None
                        post.image_url = None
                    except Exception as exc:
                        print(f"[threads_cleanup] error processing post {post.id}: {exc}", flush=True)

                await db.commit()

        # Run once per day
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=86400)
        except asyncio.TimeoutError:
            pass
