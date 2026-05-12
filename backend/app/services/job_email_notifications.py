from __future__ import annotations

import asyncio
import html
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.database import SessionLocal
from app.db_models import Job, JobLog, JobStatus, JobType, Recipe, RecipeStatus
from app.services.email_service import send_email

logger = logging.getLogger(__name__)

MIN_EMAIL_NOTIFICATION_ROWS = 10
PUBLISH_META_PREFIX = "__PUBLISH_BATCH_META__:"
TERMINAL_STATUSES = (JobStatus.completed, JobStatus.failed, JobStatus.stopped)


def _job_type_label(job_type: JobType) -> str:
    if job_type == JobType.publisher:
        return "WordPress publishing"
    if job_type == JobType.articles_all_sites:
        return "All-sites recipe generation"
    if job_type == JobType.auto_spy_generate:
        return "Auto Spy generation"
    return "Recipe generation"


def _status_label(status: JobStatus) -> str:
    if status == JobStatus.completed:
        return "completed"
    if status == JobStatus.failed:
        return "failed"
    if status == JobStatus.stopped:
        return "stopped"
    return status.value if hasattr(status, "value") else str(status)


def _fmt_dt(value: datetime | None) -> str:
    if value is None:
        return "n/a"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _parse_publish_meta(message: str) -> dict[str, Any] | None:
    idx = message.find(PUBLISH_META_PREFIX)
    if idx == -1:
        return None
    payload = message[idx + len(PUBLISH_META_PREFIX):].strip()
    try:
        parsed = json.loads(payload)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _uuid_values(values: Any) -> list[uuid.UUID]:
    if not isinstance(values, list):
        return []
    out: list[uuid.UUID] = []
    for value in values:
        try:
            out.append(uuid.UUID(str(value)))
        except Exception:
            continue
    return out


async def _publisher_claimed_ids(db, job_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await db.execute(
        select(JobLog.message)
        .where(JobLog.job_id == job_id)
        .order_by(JobLog.created_at.asc())
    )
    claimed: list[uuid.UUID] = []
    for message in rows.scalars().all():
        meta = _parse_publish_meta(message)
        if not meta:
            continue
        values = meta.get("_claimed_recipe_ids") or meta.get("recipe_ids")
        parsed = _uuid_values(values)
        if parsed:
            claimed = parsed
    return claimed


async def _build_recipe_summary(db, job: Job) -> dict[str, int | list[tuple[str, str]]]:
    claimed_ids: list[uuid.UUID] = []
    if job.job_type == JobType.publisher:
        claimed_ids = await _publisher_claimed_ids(db, job.id)

    recipe_filter = Recipe.id.in_(claimed_ids) if claimed_ids else Recipe.created_by_job_id == job.id

    status_count = lambda status: func.coalesce(
        func.sum(case((Recipe.status == status, 1), else_=0)),
        0,
    )

    counts = await db.execute(
        select(
            func.count(Recipe.id).label("total"),
            func.count(func.distinct(Recipe.site_id)).label("sites"),
            status_count(RecipeStatus.pending).label("pending"),
            status_count(RecipeStatus.generating).label("generating"),
            status_count(RecipeStatus.generated).label("generated"),
            status_count(RecipeStatus.publishing).label("publishing"),
            status_count(RecipeStatus.published).label("published"),
            status_count(RecipeStatus.failed).label("failed"),
        ).where(recipe_filter)
    )
    row = counts.one()

    errors_rows = await db.execute(
        select(Recipe.recipe_text, Recipe.error_message)
        .where(
            recipe_filter,
            Recipe.status == RecipeStatus.failed,
            Recipe.error_message.is_not(None),
            Recipe.error_message != "",
        )
        .order_by(Recipe.created_at.asc())
        .limit(5)
    )

    return {
        "total": int(row.total or 0),
        "sites": int(row.sites or 0),
        "pending": int(row.pending or 0),
        "generating": int(row.generating or 0),
        "generated": int(row.generated or 0),
        "publishing": int(row.publishing or 0),
        "published": int(row.published or 0),
        "failed": int(row.failed or 0),
        "errors": [
            (str(recipe_text or "Recipe")[:90], str(error or "")[:300])
            for recipe_text, error in errors_rows.all()
        ],
    }


def _summary_html(job: Job, summary: dict[str, Any]) -> str:
    job_label = _job_type_label(job.job_type)
    status = _status_label(job.status)
    project_name = html.escape(job.project.name if job.project else "Project")
    user_name = html.escape(job.creator.full_name or job.creator.email)
    job_url = f"{settings.frontend_url.rstrip('/')}/jobs/{job.id}"
    total_rows = int(job.total_rows or summary["total"] or 0)
    current_row = int(job.current_row or 0)
    errors: list[tuple[str, str]] = summary.get("errors", [])

    error_html = ""
    if job.error:
        error_html += (
            '<p style="margin:12px 0 0;color:#b91c1c">'
            f"<strong>Error:</strong> {html.escape(job.error[:500])}</p>"
        )
    if errors:
        items = "".join(
            "<li>"
            f"<strong>{html.escape(title)}</strong>: {html.escape(message)}"
            "</li>"
            for title, message in errors
        )
        error_html += (
            '<div style="margin-top:16px">'
            '<p style="margin:0 0 8px;color:#475569;font-weight:600">First failed recipes</p>'
            f'<ul style="margin:0;padding-left:18px;color:#64748b;line-height:1.5">{items}</ul>'
            "</div>"
        )

    return f"""
    <div style="font-family:sans-serif;max-width:620px;margin:auto;padding:24px;color:#0f172a">
      <p style="margin:0 0 8px;color:#64748b">Hi {user_name},</p>
      <h2 style="margin:0 0 12px;color:#1e293b">{html.escape(job_label)} {html.escape(status)}</h2>
      <p style="margin:0 0 20px;color:#475569">
        Your background job for <strong>{project_name}</strong> has finished.
      </p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0">
        <tr>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#64748b">Status</td>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:700">{html.escape(status)}</td>
        </tr>
        <tr>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#64748b">Progress</td>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0">{current_row} / {total_rows}</td>
        </tr>
        <tr>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#64748b">Sites</td>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0">{int(summary["sites"])}</td>
        </tr>
        <tr>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#64748b">Generated</td>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0">{int(summary["generated"])}</td>
        </tr>
        <tr>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#64748b">Published</td>
          <td style="padding:10px;border-bottom:1px solid #e2e8f0">{int(summary["published"])}</td>
        </tr>
        <tr>
          <td style="padding:10px;color:#64748b">Failed</td>
          <td style="padding:10px">{int(summary["failed"])}</td>
        </tr>
      </table>

      <p style="margin:0;color:#64748b;font-size:13px">
        Started: {_fmt_dt(job.created_at)}<br>
        Finished: {_fmt_dt(job.finished_at)}
      </p>
      {error_html}
      <a href="{html.escape(job_url)}"
         style="display:inline-block;margin:22px 0 0;padding:12px 18px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">
        Open job summary
      </a>
    </div>
    """


async def send_job_completion_email_if_needed(job_id: uuid.UUID) -> bool:
    async with SessionLocal() as db:
        row = await db.execute(
            select(Job)
            .options(selectinload(Job.creator), selectinload(Job.project))
            .where(Job.id == job_id)
        )
        job = row.scalar_one_or_none()
        if job is None:
            return False
        if job.email_notification_sent_at is not None:
            return False
        if job.status not in TERMINAL_STATUSES:
            return False
        if not job.creator or not job.creator.email:
            return False
        if (job.total_rows or 0) <= MIN_EMAIL_NOTIFICATION_ROWS:
            return False

        summary = await _build_recipe_summary(db, job)
        subject = (
            f"{_job_type_label(job.job_type)} {_status_label(job.status)} "
            f"({job.current_row or 0}/{job.total_rows or summary['total']})"
        )
        html_body = _summary_html(job, summary)
        to_email = job.creator.email

    await send_email(to_email, subject, html_body)

    async with SessionLocal() as db:
        row = await db.execute(select(Job).where(Job.id == job_id))
        job = row.scalar_one_or_none()
        if job and job.email_notification_sent_at is None:
            job.email_notification_sent_at = datetime.now(timezone.utc)
            await db.commit()
    return True


async def notify_pending_job_emails_once(limit: int = 25) -> int:
    async with SessionLocal() as db:
        rows = await db.execute(
            select(Job.id)
            .where(
                Job.email_notification_sent_at.is_(None),
                Job.status.in_(TERMINAL_STATUSES),
                Job.total_rows.is_not(None),
                Job.total_rows > MIN_EMAIL_NOTIFICATION_ROWS,
            )
            .order_by(Job.finished_at.asc().nulls_last(), Job.created_at.asc())
            .limit(limit)
        )
        job_ids = rows.scalars().all()

    sent = 0
    for job_id in job_ids:
        try:
            if await send_job_completion_email_if_needed(job_id):
                sent += 1
        except Exception:
            logger.exception("Failed to send job completion email for job %s", job_id)
    return sent


async def run_job_email_notifier(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await notify_pending_job_emails_once()
        except Exception:
            logger.exception("Job email notifier failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=30)
        except asyncio.TimeoutError:
            pass
