from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

from sqlalchemy import func, or_, select, update

from app.config import settings
from app.crypto import decrypt
from app.database import SessionLocal
from app.db_models import (
    FacebookCommentMode,
    FacebookContent,
    FacebookContentStatus,
    FacebookDelivery,
    FacebookDeliveryStatus,
    FacebookGenerationLog,
    FacebookPage,
    FacebookProject,
    FacebookSpyRow,
    Recipe,
    RecipeStatus,
    Site,
)
from app.services import facebook_api
from app.services.facebook_video import validate_facebook_reel_file
from app.services.publisher import publish_recipe
from app.site_credentials import get_random_wp_credentials

logger = logging.getLogger(__name__)
_content_locks: dict[uuid.UUID, asyncio.Lock] = {}
_content_locks_guard = asyncio.Lock()
UPLOADS_ROOT = Path(os.getenv("UPLOADS_DIR", "/app/uploads"))
FACEBOOK_UPLOADS_ROOT = UPLOADS_ROOT / "facebook"
FACEBOOK_SOURCE_ROOT = FACEBOOK_UPLOADS_ROOT / "sources"
VIDEO_SUFFIXES = {".mp4", ".mov", ".webm", ".m4v"}
DEFAULT_VIDEO_RETENTION_HOURS = 1.0


def build_first_comment(
    mode: FacebookCommentMode | str,
    full_recipe: str,
    article_url: str,
) -> str:
    value = mode.value if hasattr(mode, "value") else str(mode)
    if value == FacebookCommentMode.full_recipe_url.value:
        url = (article_url or "").strip()
        if not url:
            raise ValueError("The WordPress recipe URL is missing.")
        return f"Full Recipe : {url}"
    recipe = (full_recipe or "").strip()
    if not recipe:
        raise ValueError(
            "The generated full recipe is missing. Regenerate this content before publishing."
        )
    return recipe


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


def _video_retention_hours() -> float:
    raw_value = os.getenv(
        "FACEBOOK_VIDEO_RETENTION_HOURS",
        str(DEFAULT_VIDEO_RETENTION_HOURS),
    )
    try:
        return max(0.0, float(raw_value))
    except (TypeError, ValueError):
        logger.warning(
            "Invalid FACEBOOK_VIDEO_RETENTION_HOURS=%r; using %.1f hour",
            raw_value,
            DEFAULT_VIDEO_RETENTION_HOURS,
        )
        return DEFAULT_VIDEO_RETENTION_HOURS


def _local_upload_path(raw_url: str | None) -> Path | None:
    """Resolve only this application's /uploads URLs into the upload volume."""
    if not raw_url:
        return None
    parsed = urlparse(raw_url)
    if parsed.hostname:
        server_hostname = (urlparse(settings.server_base_url).hostname or "").lower()
        if not server_hostname or parsed.hostname.lower() != server_hostname:
            return None
    path = unquote(parsed.path if parsed.scheme else raw_url)
    marker = "/uploads/"
    if marker not in path:
        return None
    candidate = (UPLOADS_ROOT / path.split(marker, 1)[1]).resolve()
    try:
        candidate.relative_to(UPLOADS_ROOT.resolve())
    except ValueError:
        return None
    return candidate


def _delete_content_video_files(
    content_id: uuid.UUID,
    *,
    source_video_url: str,
    processed_video_url: str | None,
    delete_source: bool,
) -> tuple[int, int, list[str]]:
    """Delete locally-owned videos and return count, bytes and failed paths."""
    candidates: set[Path] = set()
    work_dir = (FACEBOOK_UPLOADS_ROOT / str(content_id)).resolve()
    try:
        work_dir.relative_to(FACEBOOK_UPLOADS_ROOT.resolve())
    except ValueError:
        return 0, 0, [str(work_dir)]
    if work_dir.is_dir():
        candidates.update(
            path.resolve()
            for path in work_dir.iterdir()
            if path.is_file() and path.suffix.lower() in VIDEO_SUFFIXES
        )

    processed_path = _local_upload_path(processed_video_url)
    if processed_path is not None:
        try:
            processed_path.relative_to(FACEBOOK_UPLOADS_ROOT.resolve())
            candidates.add(processed_path)
        except ValueError:
            pass

    if delete_source:
        source_path = _local_upload_path(source_video_url)
        if source_path is not None:
            try:
                source_path.relative_to(FACEBOOK_SOURCE_ROOT.resolve())
                candidates.add(source_path)
            except ValueError:
                pass

    deleted_count = 0
    deleted_bytes = 0
    failures: list[str] = []
    for path in candidates:
        try:
            exists = path.is_file()
            size = path.stat().st_size if exists else 0
            path.unlink(missing_ok=True)
            if exists:
                deleted_count += 1
                deleted_bytes += size
        except OSError:
            failures.append(str(path))
            logger.exception("Could not delete published Facebook video %s", path)
    return deleted_count, deleted_bytes, failures


def delete_facebook_content_files(
    content_id: uuid.UUID,
    *,
    source_video_url: str,
    processed_video_url: str | None,
    delete_source: bool,
) -> tuple[int, int, list[str]]:
    """Remove every locally generated file for a manually deleted generation."""
    candidates: set[Path] = set()
    work_dir = (FACEBOOK_UPLOADS_ROOT / str(content_id)).resolve()
    try:
        work_dir.relative_to(FACEBOOK_UPLOADS_ROOT.resolve())
    except ValueError:
        return 0, 0, [str(work_dir)]
    if work_dir.is_dir():
        candidates.update(path.resolve() for path in work_dir.iterdir() if path.is_file())

    processed_path = _local_upload_path(processed_video_url)
    if processed_path is not None:
        try:
            processed_path.relative_to(FACEBOOK_UPLOADS_ROOT.resolve())
            candidates.add(processed_path)
        except ValueError:
            pass

    if delete_source:
        source_path = _local_upload_path(source_video_url)
        if source_path is not None:
            try:
                source_path.relative_to(FACEBOOK_SOURCE_ROOT.resolve())
                candidates.add(source_path)
            except ValueError:
                pass

    deleted_count = 0
    deleted_bytes = 0
    failures: list[str] = []
    for path in candidates:
        try:
            exists = path.is_file()
            size = path.stat().st_size if exists else 0
            path.unlink(missing_ok=True)
            if exists:
                deleted_count += 1
                deleted_bytes += size
        except OSError:
            failures.append(str(path))
            logger.exception("Could not delete Facebook generation asset %s", path)
    try:
        work_dir.rmdir()
    except FileNotFoundError:
        pass
    except OSError:
        # A future asset type or a transient file may still be present. The
        # individual deletion failures are enough to diagnose the cleanup.
        if work_dir.exists() and not any(work_dir.iterdir()):
            failures.append(str(work_dir))
    return deleted_count, deleted_bytes, failures


async def cleanup_published_facebook_content_video(
    content_id: uuid.UUID,
    *,
    now: datetime | None = None,
    retention_hours: float | None = None,
) -> bool:
    """Delete a content video's local files after every Page delivery is published."""
    current_time = now or datetime.now(timezone.utc)
    retention = _video_retention_hours() if retention_hours is None else max(0.0, retention_hours)
    async with SessionLocal() as db:
        content = (
            await db.execute(
                select(FacebookContent)
                .where(FacebookContent.id == content_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if content is None:
            return False

        delivery_rows = (
            await db.execute(
                select(
                    FacebookDelivery.status,
                    FacebookDelivery.published_at,
                    FacebookDelivery.processed_video_url,
                ).where(FacebookDelivery.content_id == content_id)
            )
        ).all()
        # Keep cleanup tolerant of deliveries created before Page-specific
        # video URLs existed (and of interrupted deployments during migration).
        delivery_rows = [
            (
                row[0],
                row[1],
                row[2] if len(row) > 2 else None,
            )
            for row in delivery_rows
        ]
        if not content.processed_video_url and not any(
            processed_video_url
            for _delivery_status, _published_at, processed_video_url in delivery_rows
        ):
            return False
        if not delivery_rows or any(
            delivery_status != FacebookDeliveryStatus.published
            for delivery_status, _published_at, _processed_video_url in delivery_rows
        ):
            return False

        published_times = [
            published_at
            for _delivery_status, published_at, _processed_video_url in delivery_rows
            if published_at is not None
        ]
        if not published_times:
            return False
        latest_publication = max(published_times)
        if latest_publication.tzinfo is None:
            latest_publication = latest_publication.replace(tzinfo=timezone.utc)
        if latest_publication > current_time - timedelta(hours=retention):
            return False

        other_content_references = int(
            (
                await db.execute(
                    select(func.count(FacebookContent.id)).where(
                        FacebookContent.id != content_id,
                        FacebookContent.source_video_url == content.source_video_url,
                        FacebookContent.generation_cancelled.is_(False),
                        or_(
                            FacebookContent.processed_video_url.is_not(None),
                            FacebookContent.status.in_(
                                [
                                    FacebookContentStatus.processing,
                                    FacebookContentStatus.failed,
                                ]
                            ),
                        ),
                    )
                )
            ).scalar_one()
        )
        spy_sheet_references = int(
            (
                await db.execute(
                    select(func.count(FacebookSpyRow.id)).where(
                        FacebookSpyRow.direct_link == content.source_video_url
                    )
                )
            ).scalar_one()
        )
        delete_source = other_content_references == 0 and spy_sheet_references == 0
        deleted_count, deleted_bytes, failures = await asyncio.to_thread(
            _delete_content_video_files,
            content.id,
            source_video_url=content.source_video_url,
            processed_video_url=content.processed_video_url,
            delete_source=delete_source,
        )
        if failures:
            db.add(
                FacebookGenerationLog(
                    project_id=content.project_id,
                    content_id=content.id,
                    level="warning",
                    stage="cleanup",
                    message=(
                        "Published-video cleanup could not remove every file and will "
                        "retry automatically."
                    ),
                )
            )
            await db.commit()
            return False

        content.processed_video_url = None
        if any(row[2] for row in delivery_rows):
            await db.execute(
                update(FacebookDelivery)
                .where(FacebookDelivery.content_id == content_id)
                .values(processed_video_url=None)
            )
        freed_mb = deleted_bytes / (1024 * 1024)
        source_note = (
            "unshared local source released"
            if delete_source
            else "shared source preserved"
        )
        db.add(
            FacebookGenerationLog(
                project_id=content.project_id,
                content_id=content.id,
                level="success",
                stage="cleanup",
                message=(
                    f"Published-video cleanup removed {deleted_count} file(s), freed "
                    f"{freed_mb:.1f} MB, {source_note}."
                ),
            )
        )
        await db.commit()
    logger.info(
        "Cleaned published Facebook content %s: %s file(s), %.1f MB",
        content_id,
        deleted_count,
        freed_mb,
    )
    return True


async def cleanup_published_facebook_videos(*, limit: int = 200) -> int:
    """Clean eligible historical publications in bounded batches."""
    async with SessionLocal() as db:
        rows = await db.execute(
            select(FacebookContent.id)
            .where(
                FacebookContent.processed_video_url.is_not(None),
                select(FacebookDelivery.id)
                .where(FacebookDelivery.content_id == FacebookContent.id)
                .exists(),
                ~select(FacebookDelivery.id)
                .where(
                    FacebookDelivery.content_id == FacebookContent.id,
                    FacebookDelivery.status != FacebookDeliveryStatus.published,
                )
                .exists(),
            )
            .order_by(FacebookContent.updated_at.asc())
            .limit(limit)
        )
        content_ids = list(rows.scalars().all())
    cleaned = 0
    for content_id in content_ids:
        try:
            cleaned += int(await cleanup_published_facebook_content_video(content_id))
        except Exception:
            logger.exception("Published Facebook video cleanup failed for %s", content_id)
    return cleaned


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


async def _validate_reel_upload_source(
    *, stored_video_url: str, public_video_url: str
) -> dict:
    """Fail with an actionable reason before WordPress or Meta is mutated."""

    # The stored URL can contain an older hostname after a deployment/domain
    # change. Prefer the normalized current public URL, then fall back to it.
    local_path = _local_upload_path(public_video_url) or _local_upload_path(
        stored_video_url
    )
    if local_path is None:
        raise ValueError(
            "The generated Reel is not stored in this application's upload volume. "
            "Regenerate it before publishing."
        )
    media = await asyncio.to_thread(validate_facebook_reel_file, local_path)
    try:
        public = await asyncio.to_thread(
            facebook_api.validate_public_video_url,
            public_video_url,
        )
    except ValueError as exc:
        # Direct binary upload does not require Meta to fetch this URL. Keep the
        # preview/CDN diagnostic for logs without blocking a valid local file.
        logger.warning(
            "Facebook public video URL preflight failed; direct upload will continue: %s",
            exc,
        )
        public = {"warning": str(exc)}
    return {"media": media, "public_url": public, "local_path": local_path}


async def _publish_facebook_image_delivery(delivery_id: uuid.UUID) -> bool:
    try:
        async with SessionLocal() as db:
            row = await db.execute(
                select(FacebookDelivery, FacebookContent, FacebookPage, Recipe)
                .join(FacebookContent, FacebookContent.id == FacebookDelivery.content_id)
                .join(FacebookPage, FacebookPage.id == FacebookDelivery.page_id)
                .outerjoin(Recipe, Recipe.id == FacebookContent.recipe_id)
                .where(FacebookDelivery.id == delivery_id)
            )
            record = row.one_or_none()
            if record is None:
                raise ValueError("Generated Facebook image content was not found.")
            delivery, content, page, recipe = record
            image_url = delivery.generated_image_url
            if not image_url:
                raise ValueError("Generated Page image is not ready.")
            image_path = _local_upload_path(image_url)
            if image_path is None or not image_path.is_file():
                raise ValueError("Generated Page image is missing from the server.")
            page_token = decrypt(page.access_token)
            page_id = page.facebook_page_id
            page_mode = page.comment_mode
            content_id = content.id
            existing_post_id = delivery.facebook_post_id
            existing_comment_id = delivery.first_comment_id
            recipe_post = (content.recipe_post or "").strip()
            if not recipe_post:
                raise ValueError("Recipe Post is missing. Regenerate this image post.")
            generate_article = bool(content.generate_article)
            allow_without_url = bool(delivery.allow_without_article_url)
            title = content.title

        article_url = ""
        if generate_article:
            article_url = await _ensure_article_published(content_id)
        elif (
            page_mode == FacebookCommentMode.full_recipe_url
            and not allow_without_url
        ):
            raise ValueError(
                "The article was not generated, so this Page cannot add an article URL. "
                "Confirm publishing without the link and retry."
            )

        post_id = existing_post_id
        if not post_id:
            post_id = await asyncio.to_thread(
                facebook_api.publish_page_photo,
                page_id=page_id,
                page_access_token=page_token,
                caption=title,
                image_path=image_path,
            )
            async with SessionLocal() as db:
                await db.execute(
                    update(FacebookDelivery)
                    .where(FacebookDelivery.id == delivery_id)
                    .values(facebook_post_id=post_id)
                )
                await db.commit()

        comment_id = existing_comment_id
        if not comment_id:
            effective_mode = (
                FacebookCommentMode.full_recipe
                if not article_url
                else page_mode
            )
            comment_id = await asyncio.to_thread(
                facebook_api.add_first_comment,
                post_id=post_id,
                page_access_token=page_token,
                message=build_first_comment(
                    effective_mode,
                    recipe_post,
                    article_url,
                ),
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
        logger.exception("Facebook image delivery %s failed", delivery_id)
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


async def publish_facebook_delivery(
    delivery_id: uuid.UUID,
    *,
    already_claimed: bool = False,
) -> bool:
    if not already_claimed:
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
                select(FacebookDelivery, FacebookContent, FacebookPage, Recipe)
                .join(FacebookContent, FacebookContent.id == FacebookDelivery.content_id)
                .join(FacebookPage, FacebookPage.id == FacebookDelivery.page_id)
                .outerjoin(Recipe, Recipe.id == FacebookContent.recipe_id)
                .where(FacebookDelivery.id == delivery_id)
            )
            delivery, content, page, recipe = row.one()
            if getattr(content, "post_type", "video") == "image":
                return await _publish_facebook_image_delivery(delivery_id)
            if recipe is None:
                raise ValueError("Generated recipe is missing for this video post.")
            stored_video_url = (
                getattr(delivery, "processed_video_url", None)
                or content.processed_video_url
            )
            if not stored_video_url:
                raise ValueError("Processed video is not ready.")
            page_token = decrypt(page.access_token)
            page_id = page.facebook_page_id
            page_mode = page.comment_mode
            title = content.title
            video_url = _absolute_media_url(stored_video_url)
            content_id = content.id
            existing_post_id = delivery.facebook_post_id
            existing_comment_id = delivery.first_comment_id
            full_recipe = recipe.generated_full_recipe or ""

        post_id = existing_post_id
        upload_url: str | None = None
        upload_source: dict | None = None
        existing_status: dict = {}
        if post_id:
            existing_status = await asyncio.to_thread(
                facebook_api.get_reel_status,
                video_id=post_id,
                page_access_token=page_token,
            )
            # A failed Meta upload session cannot be resumed. It is safe to
            # replace its ID because Facebook never published that failed Reel.
            if facebook_api.reel_has_failed(existing_status):
                post_id = None
                existing_status = {}

        # Validate only when Meta still needs the asset. This also
        # keeps retries idempotent when a prior upload completed but publishing
        # or the first comment was interrupted.
        if not post_id or not facebook_api.reel_upload_is_complete(existing_status):
            upload_source = await _validate_reel_upload_source(
                stored_video_url=stored_video_url,
                public_video_url=video_url,
            )

        # Publishing the article remains the first external publication step,
        # but invalid or missing video files are rejected before creating an
        # otherwise orphaned WordPress post.
        article_url = await _ensure_article_published(content_id)

        if not post_id:
            post_id, upload_url = await asyncio.to_thread(
                facebook_api.start_reel_upload,
                page_id=page_id,
                page_access_token=page_token,
            )
            # Persist as soon as Meta creates the upload session. A backend
            # restart after this point resumes the same Reel instead of creating
            # a duplicate publication.
            async with SessionLocal() as db:
                await db.execute(
                    update(FacebookDelivery)
                    .where(FacebookDelivery.id == delivery_id)
                    .values(facebook_post_id=post_id)
                )
                await db.commit()

        if not facebook_api.reel_is_published(existing_status):
            if not facebook_api.reel_upload_is_complete(existing_status):
                if not upload_source or not upload_source.get("local_path"):
                    raise ValueError(
                        "Facebook Reel direct upload failed: the validated local video path is missing."
                    )
                await asyncio.to_thread(
                    facebook_api.upload_local_reel,
                    upload_url=upload_url or facebook_api.reel_upload_url(post_id),
                    page_access_token=page_token,
                    video_path=upload_source["local_path"],
                )
            if not facebook_api.reel_finish_has_started(existing_status):
                await asyncio.to_thread(
                    facebook_api.finish_reel_publish,
                    page_id=page_id,
                    page_access_token=page_token,
                    video_id=post_id,
                    title=title,
                    description=title,
                )
        # Publishing a Reel is asynchronous. Wait for Meta to finish encoding
        # before adding the first comment or reporting the delivery as complete.
        # The ID has already been saved, so retries cannot upload a duplicate.
        await asyncio.to_thread(
            facebook_api.wait_for_reel_published,
            video_id=post_id,
            page_access_token=page_token,
        )
        comment_id = existing_comment_id
        if not comment_id:
            comment_id = await asyncio.to_thread(
                facebook_api.add_first_comment,
                post_id=post_id,
                page_access_token=page_token,
                message=build_first_comment(page_mode, full_recipe, article_url),
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
        try:
            await cleanup_published_facebook_content_video(content_id)
        except Exception:
            # Publication already succeeded. Cleanup is retried by the scheduler
            # and must never turn a successful Facebook post into a failed one.
            logger.exception(
                "Deferred published-video cleanup failed for content %s",
                content_id,
            )
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


async def recover_interrupted_facebook_deliveries() -> int:
    """Make deliveries claimed by a previous backend process retryable.

    A process can stop after changing a delivery to ``publishing`` but before
    the Facebook request or first comment completes. Scheduled work is put
    back in the scheduler queue; manually started work becomes a retryable
    failure. Persisted Facebook post IDs keep those retries idempotent.
    """
    async with SessionLocal() as db:
        scheduled = await db.execute(
            update(FacebookDelivery)
            .where(
                FacebookDelivery.status == FacebookDeliveryStatus.publishing,
                FacebookDelivery.scheduled_at.is_not(None),
            )
            .values(
                status=FacebookDeliveryStatus.scheduled,
                error_message="Publication was interrupted by a backend restart and will be retried.",
            )
            .returning(FacebookDelivery.id)
        )
        manual = await db.execute(
            update(FacebookDelivery)
            .where(
                FacebookDelivery.status == FacebookDeliveryStatus.publishing,
                FacebookDelivery.scheduled_at.is_(None),
            )
            .values(
                status=FacebookDeliveryStatus.failed,
                error_message="Publication was interrupted by a backend restart. Retry when ready.",
            )
            .returning(FacebookDelivery.id)
        )
        recovered = len(list(scheduled.scalars())) + len(list(manual.scalars()))
        await db.commit()
    if recovered:
        logger.warning("Recovered %s interrupted Facebook deliveries", recovered)
    return recovered


async def run_facebook_scheduler(stop_event: asyncio.Event) -> None:
    await recover_interrupted_facebook_deliveries()
    next_cleanup_at = datetime.now(timezone.utc)
    while not stop_event.is_set():
        now = datetime.now(timezone.utc)
        if now >= next_cleanup_at:
            cleaned = await cleanup_published_facebook_videos()
            if cleaned:
                logger.info("Cleaned videos for %s published Facebook content item(s)", cleaned)
            next_cleanup_at = now + timedelta(minutes=10)
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
