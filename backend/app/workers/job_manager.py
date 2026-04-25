from __future__ import annotations
import asyncio
import json
import logging
import random
import threading
import uuid
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)
from typing import Any

PUBLISH_META_PREFIX = "__PUBLISH_BATCH_META__:"
PUBLISH_CHUNK_SIZE = 20


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return _ensure_utc(datetime.fromisoformat(value))
    except Exception:
        return None


def _serialize_publish_meta(meta: dict[str, Any]) -> str:
    return f"{PUBLISH_META_PREFIX}{json.dumps(meta, separators=(',', ':'))}"


def _deserialize_publish_meta(message: str) -> dict[str, Any] | None:
    idx = message.find(PUBLISH_META_PREFIX)
    if idx == -1:
        return None
    payload = message[idx + len(PUBLISH_META_PREFIX):].strip()
    try:
        parsed = json.loads(payload)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _publisher_recipe_payload(
    recipe: Recipe,
    *,
    site_config: dict | None = None,
    post_date_gmt: datetime | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": str(recipe.id),
        "site_id": str(recipe.site_id),
        "recipe_text": recipe.recipe_text or "",
        "pin_title": recipe.pin_title,
        "image_url": recipe.image_url or "",
        "generated_article": recipe.generated_article or "",
        "generated_json": recipe.generated_json or "",
        "focus_keyword": recipe.focus_keyword or "",
        "meta_description": recipe.meta_description or "",
        "category": recipe.category or "",
        "generated_images": recipe.generated_images or "",
        "wp_post_id": recipe.wp_post_id or "",
        "wp_permalink": recipe.wp_permalink or "",
        "seo_title": recipe.seo_title or "",
        "wp_tags": recipe.wp_tags or "",
        "pin_blog_link": recipe.pin_blog_link or "",
    }
    if site_config is not None:
        payload["__site_config"] = site_config
    if post_date_gmt is not None:
        payload["__post_date_gmt"] = _ensure_utc(post_date_gmt)
    return payload


def _build_publish_schedule_map(
    job_id: uuid.UUID,
    recipe_items: list[dict[str, Any]],
    meta: dict[str, Any] | None,
) -> dict[str, datetime | None]:
    if not meta or not meta.get("mode"):
        return {str(item["id"]): None for item in recipe_items}

    mode = str(meta.get("mode") or "")
    first_publish_at = _parse_iso_datetime(meta.get("first_publish_at"))
    base_now = _parse_iso_datetime(meta.get("base_now")) or datetime.now(timezone.utc)
    interval_minutes = max(1, int(meta.get("interval_minutes") or 240))

    if mode == "wordpress_scheduled" and first_publish_at is not None:
        schedule_map: dict[str, datetime | None] = {}
        by_site: dict[str, list[dict[str, Any]]] = {}
        for item in recipe_items:
            by_site.setdefault(str(item["site_id"]), []).append(item)
        step = timedelta(minutes=interval_minutes)
        for site_items in by_site.values():
            for idx, item in enumerate(site_items):
                schedule_map[str(item["id"])] = first_publish_at + (step * idx)
        return schedule_map

    if mode == "manual_backdate":
        max_seconds = int(timedelta(days=183).total_seconds())
        schedule_map: dict[str, datetime | None] = {}
        for item in recipe_items:
            recipe_uuid = uuid.UUID(str(item["id"]))
            seed = job_id.int ^ recipe_uuid.int
            rng = random.Random(seed)
            offset_seconds = rng.randint(0, max(1, max_seconds))
            schedule_map[str(item["id"])] = base_now - timedelta(seconds=offset_seconds)
        return schedule_map

    return {str(item["id"]): None for item in recipe_items}


def _split_images(images: list[str], n: int) -> list[list[str]]:
    """Split *images* into *n* chunks as evenly as possible.

    Examples (4 images):
      n=4 → [[img0], [img1], [img2], [img3]]
      n=2 → [[img0, img1], [img2, img3]]
      n=3 → [[img0, img1], [img2], [img3]]
      n=6 → [[img0], [img1], [img2], [img3], [img0], [img1]]  (cycles when n > len)
    """
    if not images:
        return [[] for _ in range(n)]
    if n >= len(images):
        # More sites than images — cycle
        return [[images[i % len(images)]] for i in range(n)]
    # Divide floor-evenly; last chunk absorbs the remainder
    base, remainder = divmod(len(images), n)
    chunks: list[list[str]] = []
    idx = 0
    for i in range(n):
        size = base + (1 if i < remainder else 0)
        chunks.append(images[idx: idx + size])
        idx += size
    return chunks

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db_models import (
    Job as JobModel, JobLog, JobStatus, JobType,
    Site, Recipe, RecipeStatus, Prompt, Project,
)
from ..database import SessionLocal
from ..services.credentials_loader import load_credentials_for_job
from ..site_credentials import get_random_wp_credentials


class RunningJob:
    """In-memory representation of a running job for real-time log streaming."""

    def __init__(self, db_job_id: uuid.UUID):
        self.db_job_id = db_job_id
        self._stop_flag = threading.Event()
        self._thread: threading.Thread | None = None
        self._ws_clients: list[asyncio.Queue] = []
        self._logs: list[str] = []

    def log(self, message: str):
        timestamp = datetime.now().strftime("%H:%M:%S")
        line = f"[{timestamp}] {message}"
        self._logs.append(line)
        for q in list(self._ws_clients):
            try:
                q.put_nowait(line)
            except Exception:
                pass

    def set_progress(self, current: int, total: int):
        self._current = current
        self._total = total

    def should_stop(self) -> bool:
        return self._stop_flag.is_set()

    def request_stop(self):
        self._stop_flag.set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._ws_clients.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        if q in self._ws_clients:
            self._ws_clients.remove(q)


class JobManager:
    def __init__(self):
        self._running: dict[str, RunningJob] = {}

    def get_running(self, job_id: str) -> RunningJob | None:
        return self._running.get(job_id)

    async def _load_publish_meta(self, job_id: uuid.UUID) -> dict[str, Any] | None:
        async with SessionLocal() as session:
            rows = await session.execute(
                select(JobLog.message)
                .where(JobLog.job_id == job_id)
                .order_by(JobLog.created_at.asc())
            )
            for message in rows.scalars().all():
                meta = _deserialize_publish_meta(message)
                if meta is not None:
                    return meta
        return None

    async def _revert_publishing_claims(self, job_id: str) -> None:
        async with SessionLocal() as session:
            await session.execute(
                update(Recipe)
                .where(
                    Recipe.created_by_job_id == uuid.UUID(job_id),
                    Recipe.status == RecipeStatus.publishing,
                )
                .values(status=RecipeStatus.generated)
            )
            await session.commit()

    async def _load_publisher_chunk_payloads(
        self,
        job_id: uuid.UUID,
        schedule_map: dict[str, datetime | None],
        *,
        limit: int = PUBLISH_CHUNK_SIZE,
        site_config_cache: dict[str, dict[str, Any]] | None = None,
        site_config_override: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        async with SessionLocal() as session:
            rows = await session.execute(
                select(Recipe, Site)
                .join(Site, Recipe.site_id == Site.id)
                .where(
                    Recipe.created_by_job_id == job_id,
                    Recipe.status == RecipeStatus.publishing,
                )
                .order_by(Site.id.asc(), Recipe.created_at.asc())
                .limit(limit)
            )
            cache = site_config_cache if site_config_cache is not None else {}
            payloads: list[dict[str, Any]] = []
            for recipe, site in rows.all():
                effective_site_config = site_config_override
                if effective_site_config is None:
                    site_key = str(site.id)
                    effective_site_config = cache.get(site_key)
                    if effective_site_config is None:
                        effective_site_config = self._build_site_config(site)
                        cache[site_key] = effective_site_config
                payloads.append(
                    _publisher_recipe_payload(
                        recipe,
                        site_config=effective_site_config,
                        post_date_gmt=schedule_map.get(str(recipe.id)),
                    )
                )
            return payloads

    async def start_publish_batch_job(
        self,
        db_job: JobModel,
        db: AsyncSession,
        publish_meta: dict[str, Any],
    ) -> None:
        main_loop = asyncio.get_running_loop()
        job_id_str = str(db_job.id)
        site_scope = select(Site.id).where(Site.project_id == db_job.project_id)
        recipe_filters: list[Any] = [Recipe.site_id.in_(site_scope), Recipe.status == RecipeStatus.generated]
        site_id = publish_meta.get("site_id")
        recipe_id = publish_meta.get("recipe_id")
        recipe_ids = publish_meta.get("recipe_ids")
        if recipe_ids:
            recipe_filters.append(Recipe.id.in_([uuid.UUID(str(r)) for r in recipe_ids]))
        elif recipe_id:
            recipe_filters.append(Recipe.id == uuid.UUID(str(recipe_id)))
        elif site_id:
            recipe_filters.append(Recipe.site_id == uuid.UUID(str(site_id)))

        await db.execute(
            update(Recipe)
            .where(
                *recipe_filters,
                (Recipe.generated_article.is_(None)) | (Recipe.generated_article == ""),
            )
            .values(
                status=RecipeStatus.failed,
                error_message="Missing generated article",
            )
        )

        valid_rows = await db.execute(
            select(Recipe.id, Recipe.site_id)
            .where(
                *recipe_filters,
                Recipe.generated_article.is_not(None),
                Recipe.generated_article != "",
            )
            .order_by(Recipe.site_id.asc(), Recipe.created_at.asc())
        )
        valid_pairs = valid_rows.all()
        if not valid_pairs:
            db_job.status = JobStatus.failed
            db_job.error = "No publishable recipes found for this project."
            db_job.finished_at = datetime.now(timezone.utc)
            await db.commit()
            return

        valid_ids = [recipe_id_value for recipe_id_value, _site_id in valid_pairs]
        await db.execute(
            update(Recipe)
            .where(
                Recipe.id.in_(valid_ids),
                Recipe.status == RecipeStatus.generated,
            )
            .values(
                status=RecipeStatus.publishing,
                created_by_job_id=db_job.id,
                error_message=None,
            )
        )
        claimed_rows = await db.execute(
            select(Recipe.id, Recipe.site_id)
            .where(
                Recipe.created_by_job_id == db_job.id,
                Recipe.status == RecipeStatus.publishing,
            )
            .order_by(Recipe.site_id.asc(), Recipe.created_at.asc())
        )
        claimed_pairs = claimed_rows.all()
        if not claimed_pairs:
            db_job.status = JobStatus.failed
            db_job.error = "No claimable generated recipes found. They may already be publishing."
            db_job.finished_at = datetime.now(timezone.utc)
            await db.commit()
            return

        await db.flush()
        db.add(JobLog(job_id=db_job.id, message=_serialize_publish_meta(publish_meta)))
        await db.commit()

        schedule_map = _build_publish_schedule_map(
            db_job.id,
            [{"id": str(recipe_id_value), "site_id": str(site_id_value)} for recipe_id_value, site_id_value in claimed_pairs],
            publish_meta,
        )
        recipes_data = [{"id": str(recipe_id_value)} for recipe_id_value, _site_id in claimed_pairs]

        rj = RunningJob(db_job.id)
        self._running[job_id_str] = rj

        async def _update_recipe(recipe_id_value: str, fields: dict[str, Any]) -> None:
            async with SessionLocal() as session:
                result = await session.execute(select(Recipe).where(Recipe.id == uuid.UUID(recipe_id_value)))
                recipe = result.scalar_one_or_none()
                if not recipe:
                    return
                for key, val in fields.items():
                    if not hasattr(recipe, key) or val is None:
                        continue
                    if key == "pin_blog_link" and getattr(recipe, "pin_blog_link", None):
                        continue
                    setattr(recipe, key, val)
                if fields.get("error_message"):
                    recipe.status = RecipeStatus.failed
                else:
                    recipe.status = RecipeStatus.published
                    recipe.error_message = None
                await session.commit()

        async def _persist_progress(current: int, total: int) -> None:
            async with SessionLocal() as session:
                result = await session.execute(select(JobModel).where(JobModel.id == db_job.id))
                job = result.scalar_one_or_none()
                if job:
                    job.current_row = current
                    job.total_rows = total
                    await session.commit()

        async def _persist_final(final_status: JobStatus, logs: list[str], error: str | None = None) -> None:
            async with SessionLocal() as session:
                result = await session.execute(select(JobModel).where(JobModel.id == db_job.id))
                job = result.scalar_one_or_none()
                if job:
                    if job.status == JobStatus.stopped:
                        final_status = JobStatus.stopped
                    job.status = final_status
                    job.finished_at = datetime.now(timezone.utc)
                    job.error = error if error and final_status != JobStatus.stopped else None
                    for msg in logs:
                        session.add(JobLog(job_id=job.id, message=msg))
                    await session.commit()

        def _run() -> None:
            from ..services.publisher import publish_recipes_from_db

            def _on_recipe_done(recipe_id_value: str, fields: dict[str, Any]) -> None:
                asyncio.run_coroutine_threadsafe(
                    _update_recipe(recipe_id_value, fields),
                    main_loop,
                ).result()

            def _on_progress(current: int, total: int) -> None:
                rj.set_progress(current, total)
                asyncio.run_coroutine_threadsafe(
                    _persist_progress(current, total),
                    main_loop,
                ).result()

            def _finalize(status: JobStatus, error: str | None = None) -> None:
                asyncio.run_coroutine_threadsafe(
                    _persist_final(status, rj._logs, error),
                    main_loop,
                ).result()
                self._running.pop(job_id_str, None)

            site_config_cache: dict[str, dict[str, Any]] = {}
            processed = 0
            rj.log(f"Starting publisher job - {len(recipes_data)} recipes")
            try:
                while not rj.should_stop():
                    chunk = asyncio.run_coroutine_threadsafe(
                        self._load_publisher_chunk_payloads(
                            db_job.id,
                            schedule_map,
                            limit=PUBLISH_CHUNK_SIZE,
                            site_config_cache=site_config_cache,
                        ),
                        main_loop,
                    ).result()
                    if not chunk:
                        break
                    chunk_processed = publish_recipes_from_db(
                        recipes=chunk,
                        site_config=None,
                        log=rj.log,
                        should_stop=rj.should_stop,
                        on_progress=_on_progress,
                        on_recipe_done=_on_recipe_done,
                        progress_offset=processed,
                        progress_total=len(recipes_data),
                        emit_summary_logs=False,
                    )
                    processed += chunk_processed
                    if chunk_processed == 0:
                        break
                final_status = JobStatus.stopped if rj.should_stop() else JobStatus.completed
                if rj.should_stop():
                    asyncio.run_coroutine_threadsafe(
                        self._revert_publishing_claims(job_id_str),
                        main_loop,
                    ).result()
                rj.log("Job completed successfully" if final_status == JobStatus.completed else "Job stopped")
                _finalize(final_status)
            except Exception as exc:
                rj.log(f"Job failed: {exc}")
                asyncio.run_coroutine_threadsafe(
                    self._revert_publishing_claims(job_id_str),
                    main_loop,
                ).result()
                _finalize(JobStatus.failed, error=str(exc))

        thread = threading.Thread(target=_run, daemon=True)
        rj._thread = thread
        db_job.status = JobStatus.running
        db_job.current_row = 0
        db_job.total_rows = len(recipes_data)
        await db.commit()
        thread.start()

    async def start_job(
        self,
        db_job: JobModel,
        site_id: uuid.UUID | None,
        recipe_id: uuid.UUID | None,
        db: AsyncSession,
        shared_recipes: list[Any] | None = None,
    ):
        """Load credentials + recipes from DB and launch a background thread."""
        main_loop = asyncio.get_running_loop()
        project_id = db_job.project_id
        job_id_str = str(db_job.id)

        # Use same db session as request - same pattern as Paramètres/Settings API
        credentials = await load_credentials_for_job(db, project_id, db_job.created_by)

        if not credentials.get("openai") and db_job.job_type == JobType.articles:
            db_job.status = JobStatus.failed
            db_job.error = (
                "OpenAI API key not found. Go to Paramètres → Clés API, "
                "paste your OpenAI key (sk-...), and click Enregistrer."
            )
            db_job.finished_at = datetime.now(timezone.utc)
            await db.commit()
            return

        # Load configurable prompts — project-scoped first, fallback to owner-level
        prompts: dict[str, str] = {}
        prj_row = await db.execute(select(Project).where(Project.id == project_id))
        prj = prj_row.scalar_one_or_none()
        if prj:
            # Owner-level fallback (project_id IS NULL)
            fallback_rows = await db.execute(
                select(Prompt).where(Prompt.owner_id == prj.owner_id, Prompt.project_id.is_(None))
            )
            for p in fallback_rows.scalars().all():
                prompts[p.key] = p.value
            # Project-specific overrides
            project_rows = await db.execute(
                select(Prompt).where(Prompt.owner_id == prj.owner_id, Prompt.project_id == project_id)
            )
            for p in project_rows.scalars().all():
                prompts[p.key] = p.value

        if db_job.job_type == JobType.articles_all_sites:
            site_rows = await db.execute(
                select(Site).where(Site.project_id == project_id).order_by(Site.created_at.asc())
            )
            sites = site_rows.scalars().all()
            if not sites:
                db_job.status = JobStatus.failed
                db_job.error = "No sites configured for this project"
                db_job.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return
            if not shared_recipes:
                db_job.status = JobStatus.failed
                db_job.error = "No shared recipes provided"
                db_job.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return
        elif not site_id:
            site_rows = await db.execute(
                select(Site).where(Site.project_id == project_id).limit(1)
            )
            site_obj = site_rows.scalar_one_or_none()
            if not site_obj:
                db_job.status = JobStatus.failed
                db_job.error = "No site configured for this project"
                db_job.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return
            site_id = site_obj.id
            site_domain = site_obj.domain
            site_pinterest_url = site_obj.pinterest_url or ""
            site_config = self._build_site_config(site_obj)
        else:
            site_result = await db.execute(select(Site).where(Site.id == site_id))
            site_obj = site_result.scalar_one_or_none()
            if not site_obj:
                db_job.status = JobStatus.failed
                db_job.error = "Site not found"
                db_job.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return
            site_domain = site_obj.domain
            site_pinterest_url = site_obj.pinterest_url or ""
            site_config = self._build_site_config(site_obj)

        if db_job.job_type == JobType.articles:
            target_status = RecipeStatus.pending
        elif db_job.job_type == JobType.publisher:
            target_status = RecipeStatus.generated

        recipes_data: list[dict] = []
        multi_site_groups: list[dict] = []
        if db_job.job_type == JobType.articles_all_sites:
            site_domain = ""
            created_recipe_ids: list[uuid.UUID] = []
            try:
                for idx, item in enumerate(shared_recipes or []):
                    if isinstance(item, dict):
                        recipe_text = str(item.get("recipe_text", "")).strip()
                        image_url = str(item.get("image_url", "")).strip()
                    else:
                        recipe_text = str(getattr(item, "recipe_text", "")).strip()
                        image_url = str(getattr(item, "image_url", "")).strip()
                    if not recipe_text or not image_url:
                        continue
                    group_items: list[dict] = []
                    for s in sites:
                        new_recipe = Recipe(
                            site_id=s.id,
                            created_by=db_job.created_by,
                            created_by_job_id=db_job.id,
                            image_url=image_url,
                            recipe_text=recipe_text,
                            status=RecipeStatus.generating,
                        )
                        db.add(new_recipe)
                        await db.flush()
                        created_recipe_ids.append(new_recipe.id)
                        group_items.append(
                            {
                                "id": str(new_recipe.id),
                                "site_domain": s.domain,
                                "pinterest_url": s.pinterest_url or "",
                                "recipe_text": recipe_text,
                                "image_url": image_url,
                                "group_idx": idx + 1,
                            }
                        )
                    if group_items:
                        multi_site_groups.append({"idx": idx + 1, "items": group_items, "recipe_text": recipe_text, "image_url": image_url})
                if not multi_site_groups:
                    db_job.status = JobStatus.failed
                    db_job.error = "No valid shared recipes to process"
                    db_job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return
                recipes_data = [{"id": str(rid)} for rid in created_recipe_ids]
                await db.commit()
            except Exception as e:
                await db.rollback()
                logger.exception("Failed to create recipes for job %s", db_job.id)
                db_job.status = JobStatus.failed
                db_job.error = f"Failed to create recipes: {e}"
                db_job.finished_at = datetime.now(timezone.utc)
                await db.commit()
                return
        elif recipe_id and db_job.job_type == JobType.articles:
            recipe_query = (
                select(Recipe)
                .where(
                    Recipe.site_id == site_id,
                    Recipe.id == recipe_id,
                    Recipe.status.in_([RecipeStatus.pending, RecipeStatus.failed]),
                )
                .order_by(Recipe.created_at.asc())
            )
        else:
            recipe_query = (
                select(Recipe)
                .where(
                    Recipe.site_id == site_id,
                    Recipe.status.in_([RecipeStatus.pending, RecipeStatus.failed])
                    if db_job.job_type == JobType.articles
                    else Recipe.status == target_status,
                )
                .order_by(Recipe.created_at.asc())
            )
            if recipe_id:
                recipe_query = recipe_query.where(Recipe.id == recipe_id)

        if db_job.job_type != JobType.articles_all_sites:
            if db_job.job_type == JobType.publisher:
                publisher_filters: list[Any] = [Recipe.site_id == site_id, Recipe.status == RecipeStatus.generated]
                if recipe_id:
                    publisher_filters.append(Recipe.id == recipe_id)

                await db.execute(
                    update(Recipe)
                    .where(
                        *publisher_filters,
                        (Recipe.generated_article.is_(None)) | (Recipe.generated_article == ""),
                    )
                    .values(
                        status=RecipeStatus.failed,
                        error_message="Missing generated article",
                    )
                )

                candidate_rows = await db.execute(
                    select(Recipe.id)
                    .where(
                        *publisher_filters,
                        Recipe.generated_article.is_not(None),
                        Recipe.generated_article != "",
                    )
                    .order_by(Recipe.created_at.asc())
                )
                recipe_ids = candidate_rows.scalars().all()
                if not recipe_ids:
                    db_job.status = JobStatus.failed
                    status_label = "generated"
                    if recipe_id:
                        db_job.error = f"Recipe not found or not in '{status_label}' status"
                    else:
                        db_job.error = f"No {status_label} recipes found for this site"
                    db_job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return

                await db.execute(
                    update(Recipe)
                    .where(
                        Recipe.id.in_(recipe_ids),
                        Recipe.status == RecipeStatus.generated,
                    )
                    .values(
                        status=RecipeStatus.publishing,
                        created_by_job_id=db_job.id,
                        error_message=None,
                    )
                )
                claimed_rows = await db.execute(
                    select(Recipe.id).where(
                        Recipe.id.in_(recipe_ids),
                        Recipe.created_by_job_id == db_job.id,
                        Recipe.status == RecipeStatus.publishing,
                    ).order_by(Recipe.created_at.asc())
                )
                claimed = claimed_rows.scalars().all()
                if not claimed:
                    db_job.status = JobStatus.failed
                    db_job.error = (
                        "No claimable generated recipes found. They may already be publishing."
                    )
                    db_job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return
                if len(claimed) < len(recipe_ids):
                    logger.warning(
                        "Publisher job %s claimed %d/%d recipes; continuing with claimed subset",
                        job_id_str,
                        len(claimed),
                        len(recipe_ids),
                    )
                recipes_data = [{"id": str(recipe_id_value)} for recipe_id_value in claimed]
            else:
                recipe_rows = await db.execute(recipe_query)
                recipes_raw = recipe_rows.scalars().all()
                if not recipes_raw:
                    db_job.status = JobStatus.failed
                    status_label = "pending or failed" if db_job.job_type == JobType.articles else "generated"
                    if recipe_id:
                        db_job.error = f"Recipe not found or not in '{status_label}' status"
                    else:
                        db_job.error = f"No {status_label} recipes found for this site"
                    db_job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return

                recipes_data = [_publisher_recipe_payload(r, site_config=site_config) for r in recipes_raw]

            if db_job.job_type == JobType.articles:
                recipe_ids = [r.id for r in recipes_raw]
                # Atomic claim: only take recipes still in pending/failed.
                await db.execute(
                    update(Recipe)
                    .where(
                        Recipe.id.in_(recipe_ids),
                        Recipe.status.in_([RecipeStatus.pending, RecipeStatus.failed]),
                    )
                    .values(status=RecipeStatus.generating, created_by_job_id=db_job.id, error_message=None)
                )
                # Rebuild from rows this job actually claimed instead of trusting rowcount.
                claimed_rows = await db.execute(
                    select(Recipe).where(
                        Recipe.id.in_(recipe_ids),
                        Recipe.created_by_job_id == db_job.id,
                        Recipe.status == RecipeStatus.generating,
                    ).order_by(Recipe.created_at.asc())
                )
                claimed = claimed_rows.scalars().all()
                if not claimed:
                    db_job.status = JobStatus.failed
                    db_job.error = (
                        "No claimable pending recipes found. They may already be processing or completed."
                    )
                    db_job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return
                if len(claimed) < len(recipe_ids):
                    logger.warning(
                        "Job %s claimed %d/%d recipes; continuing with claimed subset",
                        job_id_str,
                        len(claimed),
                        len(recipe_ids),
                    )
                recipes_data = [
                    _publisher_recipe_payload(r, site_config=site_config)
                    for r in claimed
                ]

        rj = RunningJob(db_job.id)
        self._running[job_id_str] = rj

        def _run():
            from ..services.article_generator import process_recipes_from_db, generate_for_recipe, generate_images_only
            from ..services.publisher import publish_recipes_from_db

            def _on_recipe_done(recipe_id: str, fields: dict):
                future = asyncio.run_coroutine_threadsafe(
                    _update_recipe(recipe_id, fields, db_job.job_type),
                    main_loop,
                )
                future.result()

            def _on_progress(current: int, total: int):
                rj.set_progress(current, total)
                future = asyncio.run_coroutine_threadsafe(
                    _persist_progress(job_id_str, current, total),
                    main_loop,
                )
                future.result()

            rj.log(f"Starting {db_job.job_type.value} job — {len(recipes_data)} recipes")
            try:
                if db_job.job_type == JobType.articles:
                    if not credentials.get("openai"):
                        raise ValueError(
                            "OpenAI API key not found. Go to Paramètres → Clés API, paste your OpenAI key (sk-...), and click Enregistrer."
                        )

                    process_recipes_from_db(
                        recipes=recipes_data,
                        site_domain=site_domain,
                        credentials=credentials,
                        prompts=prompts,
                        log=rj.log,
                        should_stop=rj.should_stop,
                        on_progress=_on_progress,
                        on_recipe_done=_on_recipe_done,
                        pinterest_url=site_pinterest_url,
                    )
                elif db_job.job_type == JobType.publisher:
                    processed = 0
                    while not rj.should_stop():
                        chunk = asyncio.run_coroutine_threadsafe(
                            self._load_publisher_chunk_payloads(
                                db_job.id,
                                {},
                                limit=PUBLISH_CHUNK_SIZE,
                                site_config_override=site_config or None,
                            ),
                            main_loop,
                        ).result()
                        if not chunk:
                            break
                        chunk_processed = publish_recipes_from_db(
                            recipes=chunk,
                            site_config=site_config or None,
                            log=rj.log,
                            should_stop=rj.should_stop,
                            on_progress=_on_progress,
                            on_recipe_done=_on_recipe_done,
                            progress_offset=processed,
                            progress_total=len(recipes_data),
                            emit_summary_logs=False,
                        )
                        processed += chunk_processed
                        if chunk_processed == 0:
                            break
                else:
                    if not credentials.get("openai"):
                        raise ValueError(
                            "OpenAI API key not found. Go to Paramètres → Clés API, paste your OpenAI key (sk-...), and click Enregistrer."
                        )
                    total = len(recipes_data)
                    done = 0
                    discord_auth = str(credentials.get("discord_auth", "")).strip()

                    def _mark_group_failed(items: list[dict], message: str) -> None:
                        nonlocal done
                        rj.log(message)
                        for item in items:
                            if rj.should_stop():
                                break
                            _on_recipe_done(item["id"], {"error_message": message})
                            done += 1
                            _on_progress(done, total)

                    for group in multi_site_groups:
                        if rj.should_stop():
                            break
                        items = group["items"]
                        n_sites = len(items)
                        per_recipe_images: dict[str, str] = {}

                        # Strict gate: when Midjourney is configured, images must exist
                        # before we generate any article content for this input recipe.
                        if discord_auth:
                            try:
                                if not group.get("image_url"):
                                    raise ValueError(
                                        f"Input recipe {group['idx']}: missing source image URL for Midjourney"
                                    )
                                rj.log(
                                    f"Input recipe {group['idx']}: generating images for {n_sites} site(s)"
                                )
                                shared_images = generate_images_only(
                                    recipe_title=group["recipe_text"].splitlines()[0].strip(),
                                    image_url=group["image_url"],
                                    credentials=credentials,
                                    prompts=prompts,
                                    log=rj.log,
                                    should_stop=rj.should_stop,
                                )
                                if not shared_images:
                                    raise ValueError(
                                        f"Input recipe {group['idx']}: Midjourney failed to generate images"
                                    )
                                img_list: list[str] = json.loads(shared_images)
                                if not img_list:
                                    raise ValueError(
                                        f"Input recipe {group['idx']}: Midjourney returned no images"
                                    )

                                shuffled = list(img_list)
                                random.shuffle(shuffled)
                                chunks = _split_images(shuffled, n_sites)
                                rj.log(
                                    f"Distributing {len(img_list)} image(s) across "
                                    f"{n_sites} site(s) (~{len(chunks[0])} per site)"
                                )
                                for item, site_imgs in zip(items, chunks):
                                    per_recipe_images[item["id"]] = json.dumps(site_imgs)
                            except Exception as e:
                                _mark_group_failed(
                                    items,
                                    f"Input recipe {group['idx']} failed before article generation: {e}",
                                )
                                continue
                        else:
                            rj.log(
                                f"Input recipe {group['idx']}: Midjourney skipped (no Discord credentials configured)"
                            )

                        rj.log(f"Input recipe {group['idx']}: processing {n_sites} sites")
                        for item in items:
                            if rj.should_stop():
                                break
                            rj.log("=" * 50)
                            rj.log(f"RECIPE {done + 1}/{total}: {item['recipe_text'].splitlines()[0]}")
                            rj.log("=" * 50)
                            run_creds = dict(credentials)
                            # Skip Midjourney here: group images were already prepared above.
                            run_creds["discord_auth"] = ""
                            run_creds["discord_app_id"] = ""
                            run_creds["discord_guild"] = ""
                            run_creds["discord_channel"] = ""
                            run_creds["mj_version"] = ""
                            run_creds["mj_id"] = ""
                            generated = generate_for_recipe(
                                recipe_id=item["id"],
                                recipe_text=item["recipe_text"],
                                image_url=item["image_url"],
                                site_domain=item["site_domain"],
                                credentials=run_creds,
                                prompts=prompts,
                                log=rj.log,
                                should_stop=rj.should_stop,
                                pinterest_url=item.get("pinterest_url", ""),
                            )
                            if rj.should_stop():
                                break
                            if "error_message" not in generated and item["id"] in per_recipe_images:
                                generated["generated_images"] = per_recipe_images[item["id"]]
                            _on_recipe_done(item["id"], generated)
                            done += 1
                            _on_progress(done, total)

                final_status = JobStatus.stopped if rj.should_stop() else JobStatus.completed
                rj.log("Job completed successfully" if final_status == JobStatus.completed else "Job stopped")
                if rj.should_stop():
                    if db_job.job_type in (JobType.articles, JobType.articles_all_sites):
                        _revert_generating(recipes_data)
                    elif db_job.job_type == JobType.publisher:
                        future = asyncio.run_coroutine_threadsafe(
                            self._revert_publishing_claims(job_id_str),
                            main_loop,
                        )
                        future.result()
                _finalize(job_id_str, final_status, rj._logs)

            except Exception as e:
                rj.log(f"Job failed: {e}")
                if db_job.job_type in (JobType.articles, JobType.articles_all_sites):
                    _revert_generating(recipes_data)
                elif db_job.job_type == JobType.publisher:
                    future = asyncio.run_coroutine_threadsafe(
                        self._revert_publishing_claims(job_id_str),
                        main_loop,
                    )
                    future.result()
                _finalize(job_id_str, JobStatus.failed, rj._logs, error=str(e))

        async def _update_recipe(recipe_id: str, fields: dict, job_type: JobType):
            async with SessionLocal() as session:
                result = await session.execute(
                    select(Recipe).where(Recipe.id == uuid.UUID(recipe_id))
                )
                recipe = result.scalar_one_or_none()
                if not recipe:
                    return
                for key, val in fields.items():
                    if not hasattr(recipe, key) or val is None:
                        continue
                    # Don't overwrite pin_blog_link if already set by user
                    if key == "pin_blog_link" and getattr(recipe, "pin_blog_link", None):
                        continue
                    setattr(recipe, key, val)

                if "error_message" in fields and fields["error_message"]:
                    recipe.status = RecipeStatus.failed
                elif job_type in (JobType.articles, JobType.articles_all_sites):
                    recipe.status = RecipeStatus.generated
                    recipe.error_message = None
                elif job_type == JobType.publisher:
                    recipe.status = RecipeStatus.published
                    recipe.error_message = None
                await session.commit()

        def _revert_generating(recipes_list: list[dict]):
            """Revert any recipes still in 'generating' back to 'pending' when job is stopped."""
            future = asyncio.run_coroutine_threadsafe(
                _do_revert([r["id"] for r in recipes_list]),
                main_loop,
            )
            try:
                future.result(timeout=10)
            except Exception:
                pass

        async def _do_revert(recipe_ids: list[str]):
            async with SessionLocal() as session:
                await session.execute(
                    update(Recipe)
                    .where(
                        Recipe.id.in_([uuid.UUID(rid) for rid in recipe_ids]),
                        Recipe.status == RecipeStatus.generating,
                    )
                    .values(status=RecipeStatus.pending)
                )
                await session.commit()

        async def _persist_progress(jid: str, current: int, total: int):
            async with SessionLocal() as session:
                result = await session.execute(
                    select(JobModel).where(JobModel.id == uuid.UUID(jid))
                )
                job = result.scalar_one_or_none()
                if job:
                    job.current_row = current
                    job.total_rows = total
                    await session.commit()

        def _finalize(jid: str, status: JobStatus, logs: list[str], error: str | None = None):
            future = asyncio.run_coroutine_threadsafe(
                _persist_final(jid, status, logs, error),
                main_loop,
            )
            future.result()
            self._running.pop(jid, None)

        async def _persist_final(jid: str, final_status: JobStatus, logs: list[str], error: str | None):
            async with SessionLocal() as session:
                result = await session.execute(
                    select(JobModel).where(JobModel.id == uuid.UUID(jid))
                )
                job = result.scalar_one_or_none()
                if job:
                    if job.status == JobStatus.stopped:
                        final_status = JobStatus.stopped
                    job.status = final_status
                    job.finished_at = datetime.now(timezone.utc)
                    if error and final_status != JobStatus.stopped:
                        job.error = error
                    for msg in logs:
                        session.add(JobLog(job_id=job.id, message=msg))
                    await session.commit()

        thread = threading.Thread(target=_run, daemon=True)
        rj._thread = thread

        db_job.status = JobStatus.running
        db_job.total_rows = len(recipes_data)
        await db.commit()

        thread.start()

    def _build_site_config(self, site_obj) -> dict:
        wp_user, wp_pass = get_random_wp_credentials(site_obj)
        return {
            "id": str(site_obj.id),
            "domain": site_obj.domain,
            "wp_url": site_obj.wp_url,
            "wp_username": wp_user,
            "wp_password": wp_pass,
            "image_mode": getattr(site_obj, "image_mode", "featured_and_top") or "featured_and_top",
        }

    def stop_job(self, job_id: str) -> bool:
        rj = self._running.get(job_id)
        if rj:
            rj.request_stop()
            return True
        return False

    async def resume_job(self, job_id: uuid.UUID) -> bool:
        """
        Resume an interrupted job after a server restart.
        Recipes already in the DB (pending status) are reused — no new records created.
        Returns True if the job was successfully resumed.
        """
        async with SessionLocal() as db:
            result = await db.execute(select(JobModel).where(JobModel.id == job_id))
            db_job = result.scalar_one_or_none()
            if not db_job:
                return False

            # Already running in memory (shouldn't happen, but guard it)
            if str(job_id) in self._running:
                return False

            credentials = await load_credentials_for_job(db, db_job.project_id, db_job.created_by)

            prompts: dict[str, str] = {}
            prj_row = await db.execute(select(Project).where(Project.id == db_job.project_id))
            prj = prj_row.scalar_one_or_none()
            if prj:
                fallback_rows = await db.execute(
                    select(Prompt).where(Prompt.owner_id == prj.owner_id, Prompt.project_id.is_(None))
                )
                for p in fallback_rows.scalars().all():
                    prompts[p.key] = p.value
                project_rows = await db.execute(
                    select(Prompt).where(Prompt.owner_id == prj.owner_id, Prompt.project_id == db_job.project_id)
                )
                for p in project_rows.scalars().all():
                    prompts[p.key] = p.value

            main_loop = asyncio.get_running_loop()
            job_id_str = str(job_id)

            recipes_data: list[dict] = []
            multi_site_groups: list[dict] = []
            site_domain = ""
            site_config: dict = {}
            site_pinterest_url = ""

            if db_job.job_type == JobType.articles_all_sites:
                # Reload existing pending recipes grouped by (recipe_text, image_url)
                pending_rows = await db.execute(
                    select(Recipe, Site)
                    .join(Site, Recipe.site_id == Site.id)
                    .where(
                        Recipe.created_by_job_id == db_job.id,
                        Recipe.status == RecipeStatus.pending,
                    )
                    .order_by(Recipe.recipe_text, Site.created_at)
                )
                pending = pending_rows.all()
                if not pending:
                    # Nothing left to process — mark complete
                    db_job.status = JobStatus.completed
                    db_job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return False

                # Group by (recipe_text, image_url)
                groups: dict[tuple, list[dict]] = {}
                for recipe, site in pending:
                    key = (recipe.recipe_text, recipe.image_url)
                    if key not in groups:
                        groups[key] = []
                    groups[key].append({
                        "id": str(recipe.id),
                        "site_domain": site.domain,
                        "recipe_text": recipe.recipe_text,
                        "image_url": recipe.image_url,
                        "group_idx": len(groups),
                    })
                for idx, ((recipe_text, image_url), items) in enumerate(groups.items()):
                    multi_site_groups.append({
                        "idx": idx + 1,
                        "items": items,
                        "recipe_text": recipe_text,
                        "image_url": image_url,
                    })
                recipes_data = [{"id": item["id"]} for g in multi_site_groups for item in g["items"]]

            elif db_job.job_type == JobType.publisher:
                publish_meta = await self._load_publish_meta(job_id)
                claimed_rows = await db.execute(
                    select(Recipe.id, Recipe.site_id, Recipe.status)
                    .where(Recipe.created_by_job_id == db_job.id)
                    .order_by(Recipe.site_id.asc(), Recipe.created_at.asc())
                )
                claimed_pairs = claimed_rows.all()
                if not claimed_pairs:
                    db_job.status = JobStatus.completed
                    db_job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return False

                remaining_pairs = [
                    (recipe_id_value, site_id_value)
                    for recipe_id_value, site_id_value, recipe_status in claimed_pairs
                    if recipe_status == RecipeStatus.publishing
                ]
                if not remaining_pairs:
                    db_job.status = JobStatus.completed
                    db_job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return False

                schedule_map = _build_publish_schedule_map(
                    db_job.id,
                    [{"id": str(recipe_id_value), "site_id": str(site_id_value)} for recipe_id_value, site_id_value, _status in claimed_pairs],
                    publish_meta,
                )
                site_ids = {str(site_id_value) for _recipe_id_value, site_id_value, _status in claimed_pairs}
                if len(site_ids) == 1:
                    site_row = await db.execute(select(Site).where(Site.id == remaining_pairs[0][1]))
                    site_obj = site_row.scalar_one_or_none()
                    if site_obj:
                        site_domain = site_obj.domain
                        site_config = self._build_site_config(site_obj)
                else:
                    site_domain = "multiple sites"
                    site_config = {}

                recipes_data = [{"id": str(recipe_id_value)} for recipe_id_value, _site_id_value in remaining_pairs]

            else:
                target_status = RecipeStatus.pending
                site_rows = await db.execute(
                    select(Site).where(Site.project_id == db_job.project_id).limit(1)
                )
                site_obj = site_rows.scalar_one_or_none()
                if not site_obj:
                    db_job.status = JobStatus.failed
                    db_job.error = "Site not found during resume"
                    db_job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return False
                site_domain = site_obj.domain
                site_pinterest_url = site_obj.pinterest_url or ""
                site_config = self._build_site_config(site_obj)

                recipe_rows = await db.execute(
                    select(Recipe).where(
                        Recipe.created_by_job_id == db_job.id,
                        Recipe.status == target_status,
                    ).order_by(Recipe.created_at.asc())
                )
                recipes_raw = recipe_rows.scalars().all()
                if not recipes_raw:
                    db_job.status = JobStatus.completed
                    db_job.finished_at = datetime.now(timezone.utc)
                    await db.commit()
                    return False

                recipes_data = [
                    _publisher_recipe_payload(r, site_config=site_config)
                    for r in recipes_raw
                ]

            rj = RunningJob(db_job.id)
            self._running[job_id_str] = rj

            # Reuse the same inner functions from start_job — copy the run logic
            async def _update_recipe(recipe_id: str, fields: dict, job_type: JobType):
                async with SessionLocal() as session:
                    result = await session.execute(select(Recipe).where(Recipe.id == uuid.UUID(recipe_id)))
                    recipe = result.scalar_one_or_none()
                    if not recipe:
                        return
                    for key, val in fields.items():
                        if not hasattr(recipe, key) or val is None:
                            continue
                        if key == "pin_blog_link" and getattr(recipe, "pin_blog_link", None):
                            continue
                        setattr(recipe, key, val)
                    if "error_message" in fields and fields["error_message"]:
                        recipe.status = RecipeStatus.failed
                    elif job_type in (JobType.articles, JobType.articles_all_sites):
                        recipe.status = RecipeStatus.generated
                        recipe.error_message = None
                    elif job_type == JobType.publisher:
                        recipe.status = RecipeStatus.published
                        recipe.error_message = None
                    await session.commit()

            async def _persist_progress(jid: str, current: int, total: int):
                async with SessionLocal() as session:
                    result = await session.execute(select(JobModel).where(JobModel.id == uuid.UUID(jid)))
                    job = result.scalar_one_or_none()
                    if job:
                        job.current_row = current
                        job.total_rows = total
                        await session.commit()

            async def _persist_final(jid: str, final_status: JobStatus, logs: list[str], error: str | None):
                async with SessionLocal() as session:
                    result = await session.execute(select(JobModel).where(JobModel.id == uuid.UUID(jid)))
                    job = result.scalar_one_or_none()
                    if job:
                        if job.status == JobStatus.stopped:
                            final_status = JobStatus.stopped
                        job.status = final_status
                        job.finished_at = datetime.now(timezone.utc)
                        job.error = error if error and final_status != JobStatus.stopped else None
                        for msg in logs:
                            session.add(JobLog(job_id=job.id, message=msg))
                        await session.commit()

            def _run_resumed():
                from ..services.article_generator import process_recipes_from_db, generate_for_recipe, generate_images_only
                from ..services.publisher import publish_recipes_from_db

                def _on_recipe_done(recipe_id: str, fields: dict):
                    asyncio.run_coroutine_threadsafe(
                        _update_recipe(recipe_id, fields, db_job.job_type), main_loop
                    ).result()

                def _on_progress(current: int, total: int):
                    rj.set_progress(current, total)
                    asyncio.run_coroutine_threadsafe(
                        _persist_progress(job_id_str, current, total), main_loop
                    ).result()

                def _finalize(status: JobStatus, error: str | None = None):
                    asyncio.run_coroutine_threadsafe(
                        _persist_final(job_id_str, status, rj._logs, error), main_loop
                    ).result()
                    self._running.pop(job_id_str, None)

                rj.log(f"[AUTO-RESUME] Resuming {db_job.job_type.value} job with {len(recipes_data)} remaining recipes")
                try:
                    if db_job.job_type == JobType.articles:
                        process_recipes_from_db(
                            recipes=recipes_data,
                            site_domain=site_domain,
                            credentials=credentials,
                            prompts=prompts,
                            log=rj.log,
                            should_stop=rj.should_stop,
                            on_progress=_on_progress,
                            on_recipe_done=_on_recipe_done,
                            pinterest_url=site_pinterest_url,
                        )
                    elif db_job.job_type == JobType.publisher:
                        processed = done_count
                        site_config_cache: dict[str, dict[str, Any]] = {}
                        while not rj.should_stop():
                            chunk = asyncio.run_coroutine_threadsafe(
                                self._load_publisher_chunk_payloads(
                                    db_job.id,
                                    schedule_map,
                                    limit=PUBLISH_CHUNK_SIZE,
                                    site_config_cache=site_config_cache,
                                    site_config_override=site_config or None,
                                ),
                                main_loop,
                            ).result()
                            if not chunk:
                                break
                            chunk_processed = publish_recipes_from_db(
                                recipes=chunk,
                                site_config=site_config or None,
                                log=rj.log,
                                should_stop=rj.should_stop,
                                on_progress=_on_progress,
                                on_recipe_done=_on_recipe_done,
                                progress_offset=processed,
                                progress_total=total_count,
                                emit_summary_logs=False,
                            )
                            processed += chunk_processed
                            if chunk_processed == 0:
                                break
                    else:  # articles_all_sites
                        total = total_count
                        done = done_count
                        discord_auth = str(credentials.get("discord_auth", "")).strip()

                        def _mark_group_failed(items: list[dict], message: str) -> None:
                            nonlocal done
                            rj.log(message)
                            for item in items:
                                if rj.should_stop():
                                    break
                                _on_recipe_done(item["id"], {"error_message": message})
                                done += 1
                                _on_progress(done, total)

                        for group in multi_site_groups:
                            if rj.should_stop():
                                break
                            items = group["items"]
                            n_sites = len(items)
                            per_recipe_images: dict[str, str] = {}

                            if discord_auth:
                                try:
                                    if not group.get("image_url"):
                                        raise ValueError(
                                            f"Input recipe {group['idx']}: missing source image URL for Midjourney"
                                        )
                                    rj.log(
                                        f"Input recipe {group['idx']}: generating images for {n_sites} site(s)"
                                    )
                                    shared_images = generate_images_only(
                                        recipe_title=group["recipe_text"].splitlines()[0].strip(),
                                        image_url=group["image_url"],
                                        credentials=credentials,
                                        prompts=prompts,
                                        log=rj.log,
                                        should_stop=rj.should_stop,
                                    )
                                    if not shared_images:
                                        raise ValueError(
                                            f"Input recipe {group['idx']}: Midjourney failed to generate images"
                                        )
                                    img_list: list[str] = json.loads(shared_images)
                                    if not img_list:
                                        raise ValueError(
                                            f"Input recipe {group['idx']}: Midjourney returned no images"
                                        )

                                    shuffled = list(img_list)
                                    random.shuffle(shuffled)
                                    chunks = _split_images(shuffled, n_sites)
                                    rj.log(
                                        f"Distributing {len(img_list)} image(s) across "
                                        f"{n_sites} site(s) (~{len(chunks[0])} per site)"
                                    )
                                    for item, site_imgs in zip(items, chunks):
                                        per_recipe_images[item["id"]] = json.dumps(site_imgs)
                                except Exception as e:
                                    _mark_group_failed(
                                        items,
                                        f"Input recipe {group['idx']} failed before article generation: {e}",
                                    )
                                    continue
                            else:
                                rj.log(
                                    f"Input recipe {group['idx']}: Midjourney skipped (no Discord credentials configured)"
                                )

                            for item in items:
                                if rj.should_stop():
                                    break
                                run_creds = dict(credentials)
                                # Skip Midjourney here: group images were already prepared above.
                                run_creds["discord_auth"] = run_creds["discord_app_id"] = ""
                                run_creds["discord_guild"] = run_creds["discord_channel"] = ""
                                run_creds["mj_version"] = run_creds["mj_id"] = ""
                                generated = generate_for_recipe(
                                    recipe_id=item["id"],
                                    recipe_text=item["recipe_text"],
                                    image_url=item["image_url"],
                                    site_domain=item["site_domain"],
                                    credentials=run_creds,
                                    prompts=prompts,
                                    log=rj.log,
                                    should_stop=rj.should_stop,
                                    pinterest_url=item.get("pinterest_url", ""),
                                )
                                if rj.should_stop():
                                    break
                                if "error_message" not in generated and item["id"] in per_recipe_images:
                                    generated["generated_images"] = per_recipe_images[item["id"]]
                                _on_recipe_done(item["id"], generated)
                                done += 1
                                _on_progress(done, total)

                    final_status = JobStatus.stopped if rj.should_stop() else JobStatus.completed
                    rj.log("Job completed" if final_status == JobStatus.completed else "Job stopped")
                    if rj.should_stop() and db_job.job_type == JobType.publisher:
                        asyncio.run_coroutine_threadsafe(
                            self._revert_publishing_claims(job_id_str),
                            main_loop,
                        ).result()
                    _finalize(final_status)
                except Exception as e:
                    rj.log(f"Job failed: {e}")
                    if db_job.job_type == JobType.publisher:
                        asyncio.run_coroutine_threadsafe(
                            self._revert_publishing_claims(job_id_str),
                            main_loop,
                        ).result()
                    _finalize(JobStatus.failed, error=str(e))

            # Compute already-done and full-total counts so current_row/total_rows
            # reflect the entire job (not just the remaining slice).
            done_statuses = [RecipeStatus.generated, RecipeStatus.published, RecipeStatus.failed]
            if db_job.job_type == JobType.publisher:
                done_statuses = [RecipeStatus.published, RecipeStatus.failed]
            done_result = await db.execute(
                select(func.count(Recipe.id)).where(
                    Recipe.created_by_job_id == db_job.id,
                    Recipe.status.in_(done_statuses),
                )
            )
            done_count: int = done_result.scalar() or 0

            total_result = await db.execute(
                select(func.count(Recipe.id)).where(Recipe.created_by_job_id == db_job.id)
            )
            total_count: int = total_result.scalar() or len(recipes_data)

            thread = threading.Thread(target=_run_resumed, daemon=True)
            rj._thread = thread
            db_job.status = JobStatus.running
            db_job.current_row = done_count
            db_job.total_rows = total_count
            await db.commit()
            thread.start()
            logger.info("Resumed job %s (%s) with %d recipes", job_id_str, db_job.job_type.value, len(recipes_data))
            return True


job_manager = JobManager()
