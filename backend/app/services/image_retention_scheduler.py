from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from sqlalchemy import select

from app.database import SessionLocal
from app.db_models import ProjectPublishSchedule, Recipe, RecipeStatus, Site


UPLOADS_DIR = Path("/app/uploads")


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


async def _cleanup_once() -> int:
    """
    Delete cached recipe images referenced by `Recipe.generated_images`.

    Note: This deletes files from `/app/uploads` only; it does not delete recipes.
    After deletion, `Recipe.generated_images` is cleared to prevent repeated work.
    Returns the number of recipes updated.
    """
    now = datetime.now(timezone.utc)
    default_retention_days = 4
    recipes_updated = 0

    async with SessionLocal() as db:
        schedule_rows = await db.execute(
            select(ProjectPublishSchedule.project_id, ProjectPublishSchedule.image_retention_days)
        )
        retention_by_project: dict[Any, int] = {row.project_id: row.image_retention_days for row in schedule_rows.all()}

        # Candidate selection uses the minimum retention days so we don't miss small-retention projects.
        min_days = min([default_retention_days] + list(retention_by_project.values()) or [default_retention_days])
        candidate_threshold = now - timedelta(days=min_days)

        # Only touch recipes that have cached image URLs.
        candidate_stmt = (
            select(Recipe, Site.project_id)
            .join(Site, Recipe.site_id == Site.id)
            .where(
                Recipe.generated_images.isnot(None),
                Recipe.created_at <= candidate_threshold,
                Recipe.status.in_([RecipeStatus.generated, RecipeStatus.published, RecipeStatus.failed]),
            )
        )
        candidates = (await db.execute(candidate_stmt)).all()

        files_to_delete: set[Path] = set()

        # First pass: figure out which recipes are actually beyond their project's retention window.
        to_update: list[Recipe] = []
        for recipe, project_id in candidates:
            retention_days = retention_by_project.get(project_id, default_retention_days)
            age_days = (now - recipe.created_at).total_seconds() / 86400.0
            if age_days < float(retention_days):
                continue

            # Parse the generated_images field, which is a JSON array of URLs.
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

        # Delete files (best-effort).
        for p in files_to_delete:
            try:
                if p.exists():
                    p.unlink()
            except Exception:
                # Keep going; deletion is best-effort.
                pass

        # Clear references in DB so we don't repeatedly attempt deletions.
        for r in to_update:
            try:
                r.generated_images = None
                recipes_updated += 1
            except Exception:
                pass

        if to_update:
            await db.commit()

    return recipes_updated


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
    files_deleted = 0

    async with SessionLocal() as db:
        stmt = (
            select(Recipe, Site.project_id)
            .join(Site, Recipe.site_id == Site.id)
            .where(
                Site.project_id == project_id,
                Recipe.generated_images.isnot(None),
            )
        )

        if delete_all_published:
            stmt = stmt.where(Recipe.status == RecipeStatus.published)
        else:
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

        for recipe, _ in candidates:
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

        for r in to_update:
            try:
                r.generated_images = None
                recipes_updated += 1
            except Exception:
                pass

        if to_update:
            await db.commit()

    return {"recipes_updated": recipes_updated, "files_deleted": files_deleted}


async def run_image_retention_scheduler(stop_event: asyncio.Event) -> None:
    """
    Background loop to periodically run cache cleanup.
    Default cadence is 1 hour (retention is measured in days).
    """
    while not stop_event.is_set():
        try:
            await _cleanup_once()
        except Exception:
            # Best-effort cleanup; don't crash the app.
            pass

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=3600)
        except asyncio.TimeoutError:
            pass

