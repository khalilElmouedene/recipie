from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import delete as sql_delete, or_, select

from app.config import settings
from app.database import SessionLocal
from app.db_models import CleanupConfig, MidjourneyGeneration, Project, Recipe, RecipeStatus, Site, SystemCleanupState, ThreadsPost, ThreadsPostStatus


UPLOADS_DIR = Path("/app/uploads")


def _upload_subpath_from_url(url: str) -> str | None:
    """Return path relative to uploads dir, e.g. 'recipes/abc.jpg' or 'threads/x.jpeg'."""
    if not url or not isinstance(url, str):
        return None
    try:
        parsed = urlparse(url)
        path = (parsed.path or "").replace("\\", "/")
        if "/uploads/" not in path:
            return None
        sub = path.split("/uploads/", 1)[1].strip("/")
        if not sub or ".." in sub.split("/"):
            return None
        return sub
    except Exception:
        return None


def _path_from_upload_url(url: str) -> Path | None:
    sub = _upload_subpath_from_url(url)
    if not sub:
        return None
    p = (UPLOADS_DIR / sub).resolve()
    try:
        p.relative_to(UPLOADS_DIR.resolve())
    except ValueError:
        return None
    return p


def _is_local_upload_url(url: str) -> bool:
    """True if URL points to a file under our server_base_url /uploads/."""
    if not _upload_subpath_from_url(url):
        return False
    try:
        parsed = urlparse(url)
        base = urlparse(settings.server_base_url)
        if not base.netloc:
            return True
        if not parsed.netloc:
            return True
        return parsed.netloc.lower() == base.netloc.lower()
    except Exception:
        return False


def _upload_paths_from_recipe(recipe: Recipe) -> set[Path]:
    """On-disk paths for generated_images and self-hosted image_url."""
    files: set[Path] = set()
    try:
        urls = json.loads(recipe.generated_images) if recipe.generated_images else []
    except Exception:
        urls = []
    if isinstance(urls, list):
        for u in urls:
            if isinstance(u, str):
                p = _path_from_upload_url(u)
                if p:
                    files.add(p)
    if recipe.image_url and _is_local_upload_url(recipe.image_url):
        p = _path_from_upload_url(recipe.image_url)
        if p:
            files.add(p)
    return files


_DEFAULT_RETENTION_DAYS = 7


async def _get_due_cleanup_configs() -> list[tuple[Any, int]]:
    """Return list of (owner_id, interval_days) for all owners whose cleanup is enabled and due."""
    due: list[tuple[Any, int]] = []
    now = datetime.now(timezone.utc)
    try:
        async with SessionLocal() as db:
            rows = await db.execute(
                select(CleanupConfig).where(CleanupConfig.enabled == True)  # noqa: E712
            )
            configs = rows.scalars().all()
            for cfg in configs:
                interval_days = max(1, cfg.interval_days)
                if cfg.last_run_at is None:
                    due.append((cfg.owner_id, interval_days))
                elif (now - cfg.last_run_at).total_seconds() >= interval_days * 86400:
                    due.append((cfg.owner_id, interval_days))
    except Exception:
        pass
    return due


async def _update_last_run_at(owner_id: Any) -> None:
    try:
        async with SessionLocal() as db:
            row = await db.execute(select(CleanupConfig).where(CleanupConfig.owner_id == owner_id))
            cfg = row.scalar_one_or_none()
            if cfg:
                cfg.last_run_at = datetime.now(timezone.utc)
                await db.commit()
    except Exception:
        pass


# ── System-level cleanup (every 7 days, all users, no config required) ────────

_SYSTEM_CLEANUP_INTERVAL_DAYS = 7


async def _is_system_cleanup_due() -> bool:
    """Return True if the system-wide cleanup hasn't run in the last 7 days."""
    try:
        async with SessionLocal() as db:
            row = await db.execute(select(SystemCleanupState).where(SystemCleanupState.id == 1))
            state = row.scalar_one_or_none()
            if state is None or state.last_run_at is None:
                return True
            elapsed = datetime.now(timezone.utc) - state.last_run_at
            return elapsed.total_seconds() >= _SYSTEM_CLEANUP_INTERVAL_DAYS * 86400
    except Exception:
        return False


async def _update_system_cleanup_last_run() -> None:
    try:
        async with SessionLocal() as db:
            row = await db.execute(select(SystemCleanupState).where(SystemCleanupState.id == 1))
            state = row.scalar_one_or_none()
            if state is None:
                state = SystemCleanupState(id=1, last_run_at=datetime.now(timezone.utc))
                db.add(state)
            else:
                state.last_run_at = datetime.now(timezone.utc)
            await db.commit()
    except Exception:
        pass


async def _system_cleanup_all_published() -> int:
    """Delete ALL published recipes and their local images across every user/project."""
    deleted = 0
    async with SessionLocal() as db:
        stmt = (
            select(Recipe)
            .join(Site, Recipe.site_id == Site.id)
            .where(Recipe.status == RecipeStatus.published)
        )
        rows = (await db.execute(stmt)).scalars().all()
        files_to_delete: set[Path] = set()
        for recipe in rows:
            files_to_delete.update(_upload_paths_from_recipe(recipe))
            try:
                await db.delete(recipe)
                deleted += 1
            except Exception:
                pass
        for p in files_to_delete:
            try:
                if p.exists():
                    p.unlink()
            except Exception:
                pass
        if rows:
            await db.commit()
    return deleted


async def run_full_published_cleanup(owner_id: Any) -> dict:
    """Delete all published recipes belonging to owner_id and their local images."""
    recipes_deleted = 0
    files_deleted = 0

    async with SessionLocal() as db:
        stmt = (
            select(Recipe, Site.project_id)
            .join(Site, Recipe.site_id == Site.id)
            .join(Project, Site.project_id == Project.id)
            .where(
                Recipe.status == RecipeStatus.published,
                Project.owner_id == owner_id,
            )
        )
        rows = (await db.execute(stmt)).all()
        files_to_delete: set[Path] = set()

        for recipe, _ in rows:
            files_to_delete.update(_upload_paths_from_recipe(recipe))
            try:
                await db.delete(recipe)
                recipes_deleted += 1
            except Exception:
                pass

        for p in files_to_delete:
            try:
                if p.exists():
                    p.unlink()
                    files_deleted += 1
            except Exception:
                pass

        if rows:
            await db.commit()

    return {"recipes_deleted": recipes_deleted, "files_deleted": files_deleted}


async def _cleanup_once(owner_id: Any, retention_days: int) -> int:
    """
    Retention pass scoped to owner_id: delete published recipes older than retention_days
    and clear cached images for generated/failed recipes.

    Returns how many recipe rows were updated or deleted.
    """
    now = datetime.now(timezone.utc)
    recipes_updated = 0
    recipes_deleted = 0

    async with SessionLocal() as db:
        candidate_threshold = now - timedelta(days=retention_days)

        published_stmt = (
            select(Recipe, Site.project_id)
            .join(Site, Recipe.site_id == Site.id)
            .join(Project, Site.project_id == Project.id)
            .where(
                Recipe.status == RecipeStatus.published,
                Recipe.created_at <= candidate_threshold,
                Project.owner_id == owner_id,
            )
        )
        # Include rows with generated_images cache, or any local /uploads/ source image to clean up
        cache_stmt = (
            select(Recipe, Site.project_id)
            .join(Site, Recipe.site_id == Site.id)
            .join(Project, Site.project_id == Project.id)
            .where(
                Recipe.status.in_([RecipeStatus.generated, RecipeStatus.failed]),
                Recipe.created_at <= candidate_threshold,
                Project.owner_id == owner_id,
                or_(
                    Recipe.generated_images.isnot(None),
                    Recipe.image_url.like("%/uploads/%"),
                ),
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
            files_to_delete.update(_upload_paths_from_recipe(recipe))
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
                if _is_local_upload_url(r.image_url):
                    r.image_url = ""
                recipes_updated += 1
            except Exception:
                pass

        for r in to_delete_rows:
            try:
                await db.delete(r)
                recipes_deleted += 1
            except Exception:
                pass

        if to_clear:
            await db.execute(
                sql_delete(MidjourneyGeneration).where(
                    MidjourneyGeneration.recipe_id.in_([recipe.id for recipe in to_clear])
                )
            )

        if to_clear or to_delete_rows:
            await db.commit()

    return recipes_updated + recipes_deleted


async def _cleanup_pending_stale_source_images(owner_id: Any, retention_days: int) -> int:
    """Remove local source image files for pending recipes older than retention_days; clear image_url."""
    now = datetime.now(timezone.utc)
    threshold = now - timedelta(days=retention_days)
    cleared = 0

    async with SessionLocal() as db:
        rows = await db.execute(
            select(Recipe)
            .join(Site, Recipe.site_id == Site.id)
            .join(Project, Site.project_id == Project.id)
            .where(
                Recipe.status == RecipeStatus.pending,
                Recipe.created_at <= threshold,
                Project.owner_id == owner_id,
            )
        )
        recipes = rows.scalars().all()

        for recipe in recipes:
            if not recipe.image_url or not recipe.image_url.strip():
                continue
            if not _is_local_upload_url(recipe.image_url):
                continue
            p = _path_from_upload_url(recipe.image_url)
            if p and p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass
            recipe.image_url = ""
            cleared += 1

        if cleared:
            await db.commit()

    return cleared


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
                thr = now - timedelta(days=max(1, retention_days))
                stmt = stmt.where(Recipe.created_at <= thr)

        candidates = (await db.execute(stmt)).all()
        files_to_delete: set[Path] = set()
        to_update: list[Recipe] = []
        to_delete: list[Recipe] = []

        for recipe, _ in candidates:
            if delete_all_published:
                to_delete.append(recipe)

            files_to_delete.update(_upload_paths_from_recipe(recipe))
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
                    if _is_local_upload_url(r.image_url):
                        r.image_url = ""
                    recipes_updated += 1
                except Exception:
                    pass

            if to_update:
                await db.execute(
                    sql_delete(MidjourneyGeneration).where(
                        MidjourneyGeneration.recipe_id.in_([recipe.id for recipe in to_update])
                    )
                )

        if to_update or to_delete:
            await db.commit()

    return {
        "recipes_updated": recipes_updated,
        "recipes_deleted": recipes_deleted,
        "files_deleted": files_deleted,
    }


async def _cleanup_threads_media_once(retention_days: int) -> int:
    """Delete uploaded media files for Threads posts published more than retention_days days ago."""
    now = datetime.now(timezone.utc)
    threshold = now - timedelta(days=retention_days)
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
                    if "/uploads/" in parsed_path:
                        sub = parsed_path.split("/uploads/", 1)[1]
                        if ".." in sub.split("/"):
                            continue
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
    Background loop — two independent cleanup tracks, checked every hour:

    1. SYSTEM cleanup (hardcoded, every 7 days): deletes ALL published recipes + images
       across every user automatically, no configuration required. Acts as a server
       health safety net regardless of individual user settings.

    2. PER-OWNER cleanup (configurable): only runs when the owner has explicitly
       enabled it; scoped strictly to that owner's projects.
    """
    while not stop_event.is_set():
        # ── Track 1: System-wide automatic cleanup (every 7 days, all users) ──
        try:
            if await _is_system_cleanup_due():
                try:
                    await _system_cleanup_all_published()
                except Exception:
                    pass
                try:
                    await _cleanup_threads_media_once(_SYSTEM_CLEANUP_INTERVAL_DAYS)
                except Exception:
                    pass
                await _update_system_cleanup_last_run()
        except Exception:
            pass

        # ── Track 2: Per-owner configurable cleanup ──
        try:
            due_configs = await _get_due_cleanup_configs()
            for owner_id, interval_days in due_configs:
                try:
                    await _cleanup_once(owner_id, interval_days)
                except Exception:
                    pass
                try:
                    await _cleanup_pending_stale_source_images(owner_id, interval_days)
                except Exception:
                    pass
                await _update_last_run_at(owner_id)
        except Exception:
            pass

        # Check every hour — picks up config changes quickly
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=3600)
        except asyncio.TimeoutError:
            pass
