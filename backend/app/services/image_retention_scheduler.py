from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select

from app.database import SessionLocal
from app.db_models import Recipe, RecipeStatus, Site, ThreadsPost, ThreadsPostStatus


UPLOADS_DIR = Path("/app/uploads")


def _upload_paths_from_generated_images(recipe: Recipe) -> set[Path]:
    files: set[Path] = set()
    try:
        urls = json.loads(recipe.generated_images) if recipe.generated_images else []
    except Exception:
        urls = []
    if not isinstance(urls, list):
        return files
    for u in urls:
        if not isinstance(u, str):
            continue
        fn = _extract_upload_filename(u)
        if fn:
            files.add(UPLOADS_DIR / fn)
    return files


def _extract_upload_filename(url: str) -> str | None:
    """
    Extract the filename for cached uploads URLs.
    We expect something like: <base>/uploads/<filename>
    """
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url)
        path = parsed.path or ""
        if not path:
            return None
        # Only accept cached upload URLs.
        if "/uploads/" not in path:
            return None
        # Take last segment after "/uploads/"
        parts = path.split("/")
        filename = parts[-1] if parts else ""
        return filename or None
    except Exception:
        return None


RETENTION_DAYS = 7  # Auto-cleanup: delete published recipes after 7 days


async def _cleanup_once() -> int:
    """
    Hourly retention pass (fixed 7-day retention):

    - **Published** recipes older than 7 days: delete cached files from `generated_images`, then delete
      the `Recipe` row. Does not remove posts on WordPress.
    - **Generated / failed** with `generated_images` older than 7 days: delete cached files and clear
      `generated_images` only.

    Returns how many recipe rows were updated or deleted.
    """
    now = datetime.now(timezone.utc)
    recipes_updated = 0
    recipes_deleted = 0

    async with SessionLocal() as db:
        candidate_threshold = now - timedelta(days=RETENTION_DAYS)

        published_stmt = (
            select(Recipe, Site.project_id)
            .join(Site, Recipe.site_id == Site.id)
            .where(
                Recipe.status == RecipeStatus.published,
                Recipe.created_at <= candidate_threshold,
            )
        )
        cache_stmt = (
            select(Recipe, Site.project_id)
            .join(Site, Recipe.site_id == Site.id)
            .where(
                Recipe.status.in_([RecipeStatus.generated, RecipeStatus.failed]),
                Recipe.generated_images.isnot(None),
                Recipe.created_at <= candidate_threshold,
            )
        )
        published_rows = (await db.execute(published_stmt)).all()
        cache_rows = (await db.execute(cache_stmt)).all()

        seen_ids: set[Any] = set()
        files_to_delete: set[Path] = set()
        to_clear: list[Recipe] = []
        to_delete_rows: list[Recipe] = []

        def consider(recipe: Recipe, project_id: Any, *, allow_published_delete: bool) -> None:
            if recipe.id in seen_ids:
                return
            seen_ids.add(recipe.id)
            files_to_delete.update(_upload_paths_from_generated_images(recipe))
            if allow_published_delete and recipe.status == RecipeStatus.published:
                to_delete_rows.append(recipe)
            elif recipe.status in (RecipeStatus.generated, RecipeStatus.failed):
                to_clear.append(recipe)

        for recipe, project_id in published_rows:
            consider(recipe, project_id, allow_published_delete=True)
        for recipe, project_id in cache_rows:
            consider(recipe, project_id, allow_published_delete=False)

        for p in files_to_delete:
            try:
                if p.exists():
                    p.unlink()
            except Exception:
                pass

        for r in to_clear:
            try:
                r.generated_images = None
                recipes_updated += 1
            except Exception:
                pass

        for r in to_delete_rows:
            try:
                await db.delete(r)
                recipes_deleted += 1
            except Exception:
                pass

        if to_clear or to_delete_rows:
            await db.commit()

    return recipes_updated + recipes_deleted


async def cleanup_project_generated_images(
    project_id: Any,
    *,
    retention_days: int | None = None,
    published_only: bool = True,
    delete_all_published: bool = False,
) -> dict[str, int]:
    """
    Manual cleanup helper for one project.
    - delete_all_published=True: clear images for all published recipes now.
    - otherwise: clear images older than retention_days for selected statuses.
    """
    now = datetime.now(timezone.utc)
    recipes_updated = 0
    recipes_deleted = 0
    files_deleted = 0

    async with SessionLocal() as db:
        stmt = (
            select(Recipe, Site.project_id)
            .join(Site, Recipe.site_id == Site.id)
            .where(Site.project_id == project_id)
        )

        if delete_all_published:
            stmt = stmt.where(Recipe.status == RecipeStatus.published)
        else:
            stmt = stmt.where(Recipe.generated_images.isnot(None))
            statuses = [RecipeStatus.published] if published_only else [
                RecipeStatus.generated, RecipeStatus.published, RecipeStatus.failed
            ]
            stmt = stmt.where(Recipe.status.in_(statuses))
            if retention_days is not None:
                threshold = now - timedelta(days=max(1, retention_days))
                stmt = stmt.where(Recipe.created_at <= threshold)

        candidates = (await db.execute(stmt)).all()
        files_to_delete: set[Path] = set()
        to_update: list[Recipe] = []
        to_delete: list[Recipe] = []

        for recipe, _ in candidates:
            # Keep counting published recipes for delete-all mode even if they have no generated_images.
            if delete_all_published:
                to_delete.append(recipe)

            try:
                urls = json.loads(recipe.generated_images) if recipe.generated_images else []
            except Exception:
                urls = []

            if isinstance(urls, list):
                for u in urls:
                    if not isinstance(u, str):
                        continue
                    fn = _extract_upload_filename(u)
                    if fn:
                        files_to_delete.add(UPLOADS_DIR / fn)

            to_update.append(recipe)

        for p in files_to_delete:
            try:
                if p.exists():
                    p.unlink()
                    files_deleted += 1
            except Exception:
                pass

        if delete_all_published:
            for r in to_delete:
                try:
                    await db.delete(r)
                    recipes_deleted += 1
                except Exception:
                    pass
        else:
            for r in to_update:
                try:
                    r.generated_images = None
                    recipes_updated += 1
                except Exception:
                    pass

        if to_update or to_delete:
            await db.commit()

    return {
        "recipes_updated": recipes_updated,
        "recipes_deleted": recipes_deleted,
        "files_deleted": files_deleted,
    }


async def _cleanup_threads_media_once() -> int:
    """Delete uploaded media files for Threads posts published more than 7 days ago."""
    now = datetime.now(timezone.utc)
    threshold = now - timedelta(days=RETENTION_DAYS)
    cleared = 0

    async with SessionLocal() as db:
        rows = await db.execute(
            select(ThreadsPost).where(
                ThreadsPost.status == ThreadsPostStatus.published,
                ThreadsPost.media_urls.isnot(None),
                ThreadsPost.published_at <= threshold,
            )
        )
        posts = rows.scalars().all()

        for post in posts:
            try:
                urls = json.loads(post.media_urls) if post.media_urls else []
            except Exception:
                urls = []
            for u in urls:
                if not isinstance(u, str):
                    continue
                try:
                    parsed_path = urlparse(u).path or ""
                    # Strip leading /uploads/ to get subpath like "threads/abc.jpg"
                    if "/uploads/" in parsed_path:
                        sub = parsed_path.split("/uploads/", 1)[1]
                        p = UPLOADS_DIR / sub
                        if p.exists():
                            p.unlink()
                except Exception:
                    pass
            post.media_urls = None
            cleared += 1

        if posts:
            await db.commit()

    return cleared


async def run_image_retention_scheduler(stop_event: asyncio.Event) -> None:
    """
    Background loop to periodically run cache cleanup.
    Default cadence is 1 hour (retention is measured in days).
    """
    while not stop_event.is_set():
        try:
            await _cleanup_once()
        except Exception:
            pass
        try:
            await _cleanup_threads_media_once()
        except Exception:
            pass

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=3600)
        except asyncio.TimeoutError:
            pass

