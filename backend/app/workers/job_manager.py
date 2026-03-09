from __future__ import annotations
import asyncio
import logging
import threading
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db_models import (
    Job as JobModel, JobLog, JobStatus, JobType,
    Site, Recipe, RecipeStatus, Prompt,
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

    async def start_job(
        self,
        db_job: JobModel,
        site_id: uuid.UUID | None,
        recipe_id: uuid.UUID | None,
        db: AsyncSession,
    ):
        """Load credentials + recipes from DB and launch a background thread."""
        main_loop = asyncio.get_running_loop()
        project_id = db_job.project_id
        job_id_str = str(db_job.id)

        # Use same db session as request - same pattern as Paramètres/Settings API
        credentials = await load_credentials_for_job(db, project_id, db_job.created_by)

        if not credentials.get("openai"):
            logger.warning("No OpenAI key found. Loaded keys: %s", list(credentials.keys()))

        # Load configurable prompts
        prompts: dict[str, str] = {}
        prompt_rows = await db.execute(select(Prompt))
        for p in prompt_rows.scalars().all():
            prompts[p.key] = p.value

        if not site_id:
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
            site_config = self._build_site_config(site_obj)

        if db_job.job_type == JobType.articles:
            target_status = RecipeStatus.pending
        else:
            target_status = RecipeStatus.generated

        if recipe_id and db_job.job_type == JobType.articles:
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
                .where(Recipe.site_id == site_id, Recipe.status == target_status)
                .order_by(Recipe.created_at.asc())
            )
            if recipe_id:
                recipe_query = recipe_query.where(Recipe.id == recipe_id)

        recipe_rows = await db.execute(recipe_query)
        recipes_raw = recipe_rows.scalars().all()
        if not recipes_raw:
            db_job.status = JobStatus.failed
            status_label = "pending" if db_job.job_type == JobType.articles else "generated"
            if recipe_id:
                db_job.error = f"Recipe not found or not in '{status_label}' status"
            else:
                db_job.error = f"No {status_label} recipes found for this site"
            db_job.finished_at = datetime.now(timezone.utc)
            await db.commit()
            return

        recipes_data = [
            {
                "id": str(r.id),
                "recipe_text": r.recipe_text,
                "image_url": r.image_url,
                "generated_article": r.generated_article,
                "generated_json": r.generated_json,
                "focus_keyword": r.focus_keyword,
                "meta_description": r.meta_description,
                "category": r.category,
                "generated_images": r.generated_images,
            }
            for r in recipes_raw
        ]

        if db_job.job_type == JobType.articles:
            recipe_ids = [r.id for r in recipes_raw]
            await db.execute(
                update(Recipe)
                .where(Recipe.id.in_(recipe_ids))
                .values(status=RecipeStatus.generating)
            )

        rj = RunningJob(db_job.id)
        self._running[job_id_str] = rj

        def _run():
            from ..services.article_generator import process_recipes_from_db
            from ..services.publisher import publish_recipes_from_db

            def _on_recipe_done(recipe_id: str, fields: dict):
                future = asyncio.run_coroutine_threadsafe(
                    _update_recipe(recipe_id, fields, db_job.job_type),
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
                        on_progress=rj.set_progress,
                        on_recipe_done=_on_recipe_done,
                    )
                else:
                    publish_recipes_from_db(
                        recipes=recipes_data,
                        site_config=site_config,
                        log=rj.log,
                        should_stop=rj.should_stop,
                        on_progress=rj.set_progress,
                        on_recipe_done=_on_recipe_done,
                    )

                final_status = JobStatus.stopped if rj.should_stop() else JobStatus.completed
                rj.log("Job completed successfully" if final_status == JobStatus.completed else "Job stopped")
                if rj.should_stop() and db_job.job_type == JobType.articles:
                    _revert_generating(recipes_data)
                _finalize(job_id_str, final_status, rj._logs)

            except Exception as e:
                rj.log(f"Job failed: {e}")
                if db_job.job_type == JobType.articles:
                    _revert_generating(recipes_data)
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
                    if hasattr(recipe, key) and val is not None:
                        setattr(recipe, key, val)

                if "error_message" in fields and fields["error_message"]:
                    recipe.status = RecipeStatus.failed
                elif job_type == JobType.articles:
                    recipe.status = RecipeStatus.generated
                elif job_type == JobType.publisher:
                    recipe.status = RecipeStatus.published
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
        }

    def stop_job(self, job_id: str) -> bool:
        rj = self._running.get(job_id)
        if rj:
            rj.request_stop()
            return True
        return False


job_manager = JobManager()
