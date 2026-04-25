from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.database import SessionLocal
from app.db_models import Job, JobStatus, Recipe, RecipeStatus

logger = logging.getLogger(__name__)

# Jobs running longer than this are considered truly stuck (not just a restart)
STALE_RUNNING_JOB_HOURS = 8

# Old rows stuck "generating" with no job link (legacy / race)
ORPHAN_GENERATING_HOURS = 2


async def resume_interrupted_jobs() -> None:
    """
    Run once at server startup.
    Any job that was 'running' when the server shut down is automatically resumed:
      - generating recipes are reverted to pending (checkpoint)
      - the job worker thread is restarted
    Jobs older than STALE_RUNNING_JOB_HOURS are marked failed instead.
    """
    from app.workers.job_manager import job_manager

    now = datetime.now(timezone.utc)
    stale_cutoff = now - timedelta(hours=STALE_RUNNING_JOB_HOURS)

    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(Job).where(
                    Job.status == JobStatus.running,
                    Job.finished_at.is_(None),
                )
            )
        ).scalars().all()

        for job in rows:
            # Revert any recipes stuck in 'generating' back to 'pending'
            await db.execute(
                update(Recipe)
                .where(
                    Recipe.created_by_job_id == job.id,
                    Recipe.status == RecipeStatus.generating,
                )
                .values(status=RecipeStatus.pending, error_message=None)
            )

            if job.created_at <= stale_cutoff:
                # Too old - don't resume, just fail
                job.status = JobStatus.failed
                job.finished_at = now
                job.error = "Run timed out - start the job again."
                logger.info("Marked stale job %s as failed (older than %dh)", job.id, STALE_RUNNING_JOB_HOURS)
            else:
                # Recent job - reset status so resume_job can restart it
                job.status = JobStatus.pending
                await db.commit()
                resumed = await job_manager.resume_job(job.id)
                if not resumed:
                    # resume_job may have set it to completed/failed - nothing more to do
                    logger.info("Job %s had no remaining work, skipped resume", job.id)
                else:
                    logger.info("Auto-resumed job %s after server restart", job.id)
                continue  # already committed inside resume_job

        await db.commit()


async def reconcile_stale_jobs_and_recipes_once() -> None:
    """Periodic cleanup: fail genuinely stuck jobs and clear orphaned in-progress rows."""
    now = datetime.now(timezone.utc)
    stale_job_cutoff = now - timedelta(hours=STALE_RUNNING_JOB_HOURS)
    orphan_cutoff = now - timedelta(hours=ORPHAN_GENERATING_HOURS)

    async with SessionLocal() as db:
        # Only fail jobs that are truly stale (old AND not in memory)
        from app.workers.job_manager import job_manager

        stale_jobs = (
            await db.execute(
                select(Job).where(
                    Job.status == JobStatus.running,
                    Job.finished_at.is_(None),
                    Job.created_at <= stale_job_cutoff,
                )
            )
        ).scalars()

        for job in stale_jobs:
            if job_manager.get_running(str(job.id)):
                continue  # Still actively running - leave it alone
            job.status = JobStatus.failed
            job.finished_at = now
            if not job.error:
                job.error = "Run timed out - start the job again."
            await db.execute(
                update(Recipe)
                .where(
                    Recipe.created_by_job_id == job.id,
                    Recipe.status == RecipeStatus.generating,
                )
                .values(
                    status=RecipeStatus.pending,
                    error_message="Generation interrupted - try Generate again.",
                )
            )
            await db.execute(
                update(Recipe)
                .where(
                    Recipe.created_by_job_id == job.id,
                    Recipe.status == RecipeStatus.publishing,
                )
                .values(
                    status=RecipeStatus.generated,
                    error_message="Publishing interrupted - try Publish again.",
                )
            )

        # Clear in-progress rows whose job is already done
        stuck = (
            await db.execute(
                select(Recipe)
                .join(Job, Recipe.created_by_job_id == Job.id)
                .where(
                    Recipe.status.in_([RecipeStatus.generating, RecipeStatus.publishing]),
                    Job.status.in_([JobStatus.completed, JobStatus.failed, JobStatus.stopped]),
                )
            )
        ).scalars()
        for rec in stuck:
            was_publishing = rec.status == RecipeStatus.publishing
            rec.status = RecipeStatus.generated if was_publishing else RecipeStatus.pending
            rec.error_message = (
                "Stale publishing state cleared - try Publish again."
                if was_publishing
                else "Stale generating state cleared - try Generate again."
            )

        # Clear orphaned in-progress rows
        await db.execute(
            update(Recipe)
            .where(
                Recipe.status.in_([RecipeStatus.generating, RecipeStatus.publishing]),
                Recipe.created_by_job_id.is_(None),
                Recipe.created_at <= orphan_cutoff,
            )
            .values(
                status=RecipeStatus.pending,
                error_message="Connection or server issue - try again.",
            )
        )

        await db.commit()


async def run_stale_job_reconciler(stop_event: asyncio.Event) -> None:
    # First pass: resume interrupted jobs from a restart
    try:
        await resume_interrupted_jobs()
    except Exception:
        logger.exception("Error during startup job resume")

    # Periodic maintenance loop
    while not stop_event.is_set():
        try:
            await reconcile_stale_jobs_and_recipes_once()
        except Exception:
            pass
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=300)
        except asyncio.TimeoutError:
            pass
