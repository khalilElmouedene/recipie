from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.database import SessionLocal
from app.db_models import Job, JobStatus, Recipe, RecipeStatus

# Jobs left "running" after a server restart or hang — fail and unblock recipes.
STALE_RUNNING_JOB_HOURS = 8

# Old rows stuck "generating" with no job link (legacy / race).
ORPHAN_GENERATING_HOURS = 2


async def reconcile_stale_jobs_and_recipes_once() -> None:
    now = datetime.now(timezone.utc)
    stale_job_cutoff = now - timedelta(hours=STALE_RUNNING_JOB_HOURS)
    orphan_cutoff = now - timedelta(hours=ORPHAN_GENERATING_HOURS)

    async with SessionLocal() as db:
        jobs = (
            await db.execute(
                select(Job).where(
                    Job.status == JobStatus.running,
                    Job.finished_at.is_(None),
                    Job.created_at <= stale_job_cutoff,
                )
            )
        ).scalars()

        for job in jobs:
            job.status = JobStatus.failed
            job.finished_at = now
            if not job.error:
                job.error = "Run timed out or server restarted — start the job again."
            await db.execute(
                update(Recipe)
                .where(
                    Recipe.created_by_job_id == job.id,
                    Recipe.status == RecipeStatus.generating,
                )
                .values(
                    status=RecipeStatus.pending,
                    error_message="Generation interrupted — try Generate again.",
                )
            )

        stuck = (
            await db.execute(
                select(Recipe)
                .join(Job, Recipe.created_by_job_id == Job.id)
                .where(
                    Recipe.status == RecipeStatus.generating,
                    Job.status.in_([JobStatus.completed, JobStatus.failed, JobStatus.stopped]),
                )
            )
        ).scalars()

        for rec in stuck:
            rec.status = RecipeStatus.pending
            rec.error_message = "Stale generating state cleared — try Generate again."

        await db.execute(
            update(Recipe)
            .where(
                Recipe.status == RecipeStatus.generating,
                Recipe.created_by_job_id.is_(None),
                Recipe.created_at <= orphan_cutoff,
            )
            .values(
                status=RecipeStatus.pending,
                error_message="Connection or server issue — try Generate again.",
            )
        )

        await db.commit()


async def run_stale_job_reconciler(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await reconcile_stale_jobs_and_recipes_once()
        except Exception:
            pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=300)
        except asyncio.TimeoutError:
            pass
