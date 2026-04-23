from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..db_models import (
    CleanupConfig,
    Job,
    JobStatus,
    Project,
    ProjectCredential,
    ProjectMember,
    ProjectPublishSchedule,
    Recipe,
    RecipeStatus,
    Site,
    ThreadsAccount,
    ThreadsPost,
    ThreadsPostStatus,
    ThreadsProject,
    User,
    UserCredential,
    UserRole,
)
from ..dependencies import get_current_user, require_staff
from ..models import (
    DashboardStats,
    OperationsCheckOut,
    OperationsFailureOut,
    OperationsMetricOut,
    OperationsOverviewOut,
    OperationsTaskOut,
    ProjectOut,
)

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _accessible_projects_stmt(user: User):
    return (
        select(Project)
        .where(
            (Project.owner_id == user.id)
            | (
                Project.id.in_(
                    select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
                )
            )
        )
        .order_by(Project.created_at.desc())
    )


def _owner_id_for_user(user: User):
    if user.role == UserRole.owner or not user.created_by_owner_id:
        return user.id
    return user.created_by_owner_id


def _trim_detail(value: str | None, fallback: str) -> str:
    if not value:
        return fallback
    compact = " ".join(value.split())
    if len(compact) <= 160:
        return compact
    return compact[:157] + "..."


async def _count(db: AsyncSession, stmt) -> int:
    return int((await db.scalar(stmt)) or 0)


@router.get("", response_model=DashboardStats)
async def get_dashboard(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    projects_q = await db.execute(_accessible_projects_stmt(user))
    projects = projects_q.scalars().all()

    total_sites = 0
    total_recipes = 0
    total_jobs = 0
    project_outs = []

    for p in projects:
        sc = await db.scalar(select(func.count()).select_from(Site).where(Site.project_id == p.id)) or 0
        mc = await db.scalar(select(func.count()).select_from(ProjectMember).where(ProjectMember.project_id == p.id)) or 0
        rc = await db.scalar(
            select(func.count()).select_from(Recipe).join(Site, Recipe.site_id == Site.id).where(Site.project_id == p.id)
        ) or 0
        jc = await db.scalar(select(func.count()).select_from(Job).where(Job.project_id == p.id)) or 0

        total_sites += sc
        total_recipes += rc
        total_jobs += jc

        project_outs.append(ProjectOut(
            id=p.id, name=p.name, description=p.description, owner_id=p.owner_id,
            created_at=p.created_at, site_count=sc, member_count=mc,
            recipe_count=rc, job_count=jc,
        ))

    return DashboardStats(
        total_projects=len(projects),
        total_sites=total_sites,
        total_recipes=total_recipes,
        total_jobs=total_jobs,
        projects=project_outs,
    )


@router.get("/operations", response_model=OperationsOverviewOut)
async def get_operations_overview(
    user: Annotated[User, Depends(require_staff)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    projects_q = await db.execute(_accessible_projects_stmt(user))
    projects = projects_q.scalars().all()
    project_ids = [p.id for p in projects]
    project_names = {p.id: p.name for p in projects}
    owner_id = _owner_id_for_user(user)
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)

    owner_cred_rows = await db.execute(
        select(UserCredential.key_type).where(UserCredential.user_id == owner_id)
    )
    owner_key_types = set(owner_cred_rows.scalars().all())

    project_credential_map: dict = {}
    if project_ids:
        project_cred_rows = await db.execute(
            select(ProjectCredential.project_id, ProjectCredential.key_type).where(
                ProjectCredential.project_id.in_(project_ids)
            )
        )
        for project_id, key_type in project_cred_rows.all():
            project_credential_map.setdefault(project_id, set()).add(key_type)

    total_sites = 0
    published_recipes = 0
    failed_recipes = 0
    running_jobs = 0
    failed_jobs_recent = 0
    enabled_schedules = 0
    schedules_with_errors = 0

    if project_ids:
        total_sites = await _count(
            db,
            select(func.count()).select_from(Site).where(Site.project_id.in_(project_ids)),
        )
        published_recipes = await _count(
            db,
            select(func.count())
            .select_from(Recipe)
            .join(Site, Recipe.site_id == Site.id)
            .where(
                Site.project_id.in_(project_ids),
                Recipe.status == RecipeStatus.published,
            ),
        )
        failed_recipes = await _count(
            db,
            select(func.count())
            .select_from(Recipe)
            .join(Site, Recipe.site_id == Site.id)
            .where(
                Site.project_id.in_(project_ids),
                Recipe.status == RecipeStatus.failed,
            ),
        )
        running_jobs = await _count(
            db,
            select(func.count())
            .select_from(Job)
            .where(
                Job.project_id.in_(project_ids),
                Job.status == JobStatus.running,
            ),
        )
        failed_jobs_recent = await _count(
            db,
            select(func.count())
            .select_from(Job)
            .where(
                Job.project_id.in_(project_ids),
                Job.status == JobStatus.failed,
                Job.created_at >= cutoff,
            ),
        )
        enabled_schedules = await _count(
            db,
            select(func.count())
            .select_from(ProjectPublishSchedule)
            .where(
                ProjectPublishSchedule.project_id.in_(project_ids),
                ProjectPublishSchedule.enabled.is_(True),
            ),
        )
        schedules_with_errors = await _count(
            db,
            select(func.count())
            .select_from(ProjectPublishSchedule)
            .where(
                ProjectPublishSchedule.project_id.in_(project_ids),
                ProjectPublishSchedule.last_error.is_not(None),
                ProjectPublishSchedule.last_error != "",
            ),
        )

    cleanup_cfg = (
        await db.execute(select(CleanupConfig).where(CleanupConfig.owner_id == owner_id))
    ).scalar_one_or_none()

    threads_projects_count = await _count(
        db,
        select(func.count())
        .select_from(ThreadsProject)
        .where(ThreadsProject.owner_id == user.id),
    )
    threads_accounts_count = await _count(
        db,
        select(func.count())
        .select_from(ThreadsAccount)
        .join(ThreadsProject, ThreadsAccount.project_id == ThreadsProject.id)
        .where(ThreadsProject.owner_id == user.id),
    )
    scheduled_threads_posts = await _count(
        db,
        select(func.count())
        .select_from(ThreadsPost)
        .join(ThreadsProject, ThreadsPost.project_id == ThreadsProject.id)
        .where(
            ThreadsProject.owner_id == user.id,
            ThreadsPost.status == ThreadsPostStatus.scheduled,
        ),
    )

    openai_ready = "openai" in owner_key_types or any(
        "openai" in keys for keys in project_credential_map.values()
    )
    google_ready = "google_sa_json" in owner_key_types or any(
        "google_sa_json" in keys for keys in project_credential_map.values()
    )
    midjourney_required = {"discord_auth", "mj_id", "mj_version"}
    midjourney_ready = midjourney_required.issubset(owner_key_types) or any(
        midjourney_required.issubset(owner_key_types | keys)
        for keys in project_credential_map.values()
    )
    midjourney_partial = len(midjourney_required.intersection(owner_key_types))
    if not midjourney_ready:
        for keys in project_credential_map.values():
            midjourney_partial = max(
                midjourney_partial,
                len(midjourney_required.intersection(owner_key_types | keys)),
            )

    pinterest_connected_projects = sum(
        1 for keys in project_credential_map.values() if "pinterest_token" in keys
    )
    pinterest_oauth_ready = bool(
        settings.pinterest_client_id and settings.pinterest_client_secret
    )
    smtp_ready = bool(settings.smtp_user and settings.smtp_password)

    monitoring = [
        OperationsCheckOut(
            key="openai",
            label="OpenAI generation",
            status="ok" if openai_ready else "warning",
            detail=(
                "Workspace generation credentials are available."
                if openai_ready
                else "No OpenAI key is available at owner or project level."
            ),
            href="/settings" if user.role == UserRole.owner else None,
        ),
        OperationsCheckOut(
            key="midjourney",
            label="Midjourney / Discord",
            status="ok" if midjourney_ready else "warning",
            detail=(
                "Midjourney credentials are complete for at least one workflow."
                if midjourney_ready
                else f"{midjourney_partial}/3 required credentials found. Missing Discord or Midjourney keys."
            ),
            href="/settings" if user.role == UserRole.owner else None,
        ),
        OperationsCheckOut(
            key="google",
            label="Google Sheets service account",
            status="ok" if google_ready else "warning",
            detail=(
                "Google Sheets credentials are available."
                if google_ready
                else "No Google service account JSON is configured yet."
            ),
            href="/settings" if user.role == UserRole.owner else None,
        ),
        OperationsCheckOut(
            key="pinterest",
            label="Pinterest publishing",
            status=(
                "ok"
                if pinterest_oauth_ready and pinterest_connected_projects > 0
                else "warning"
            ),
            detail=(
                f"{pinterest_connected_projects} project(s) have an active Pinterest connection."
                if pinterest_oauth_ready and pinterest_connected_projects > 0
                else (
                    "Pinterest OAuth is configured but no project is connected yet."
                    if pinterest_oauth_ready
                    else "Pinterest OAuth client credentials are missing from server settings."
                )
            ),
            href="/projects",
        ),
        OperationsCheckOut(
            key="threads",
            label="Threads workspace",
            status="ok" if threads_projects_count > 0 and threads_accounts_count > 0 else "warning",
            detail=(
                f"{threads_accounts_count} account(s) connected across {threads_projects_count} Threads project(s)."
                if threads_projects_count > 0 and threads_accounts_count > 0
                else (
                    "Threads projects exist, but no account is connected yet."
                    if threads_projects_count > 0
                    else "No Threads project has been created yet."
                )
            ),
            href="/threads",
        ),
        OperationsCheckOut(
            key="smtp",
            label="Email delivery",
            status="ok" if smtp_ready else "warning",
            detail=(
                "SMTP credentials are configured for password resets and notifications."
                if smtp_ready
                else "SMTP user or password is missing in environment settings."
            ),
            href="/settings" if user.role == UserRole.owner else None,
        ),
        OperationsCheckOut(
            key="cleanup",
            label="Cleanup automation",
            status="ok" if cleanup_cfg and cleanup_cfg.enabled else "warning",
            detail=(
                f"Automatic cleanup runs every {cleanup_cfg.interval_days} day(s)."
                if cleanup_cfg and cleanup_cfg.enabled
                else "Automatic cleanup is disabled, so uploads can accumulate over time."
            ),
            href="/settings" if user.role == UserRole.owner else None,
        ),
        OperationsCheckOut(
            key="publishing",
            label="Publish schedules",
            status=(
                "critical"
                if schedules_with_errors > 0
                else ("ok" if enabled_schedules > 0 else "warning")
            ),
            detail=(
                f"{schedules_with_errors} schedule(s) currently report an error."
                if schedules_with_errors > 0
                else (
                    f"{enabled_schedules} automated publishing schedule(s) enabled."
                    if enabled_schedules > 0
                    else "No automated publishing schedule is enabled."
                )
            ),
            href="/projects",
        ),
    ]

    onboarding = [
        OperationsTaskOut(
            key="password",
            label="Set a password",
            done=bool(user.password_hash),
            detail=(
                "Password login is enabled for this account."
                if user.password_hash
                else "Set a password so this account can sign in without Google."
            ),
            href="/settings",
        ),
        OperationsTaskOut(
            key="project",
            label="Create the first project",
            done=bool(project_ids),
            detail=(
                f"{len(project_ids)} project(s) are available in this workspace."
                if project_ids
                else "Create a project to organize sites, jobs, and credentials."
            ),
            href="/projects",
        ),
        OperationsTaskOut(
            key="site",
            label="Connect a WordPress site",
            done=total_sites > 0,
            detail=(
                f"{total_sites} site(s) are already connected."
                if total_sites > 0
                else "Add a WordPress site inside a project before running generation jobs."
            ),
            href="/projects",
        ),
        OperationsTaskOut(
            key="openai",
            label="Enable AI generation",
            done=openai_ready,
            detail=(
                "OpenAI credentials are ready for content generation."
                if openai_ready
                else (
                    "Add the OpenAI key in Settings or project credentials."
                    if user.role == UserRole.owner
                    else "Ask the workspace owner to add OpenAI credentials."
                )
            ),
            href="/settings" if user.role == UserRole.owner else None,
        ),
        OperationsTaskOut(
            key="pinterest",
            label="Connect Pinterest",
            done=pinterest_connected_projects > 0,
            detail=(
                f"Pinterest is connected in {pinterest_connected_projects} project(s)."
                if pinterest_connected_projects > 0
                else "Connect Pinterest to at least one project for pin publishing."
            ),
            href="/projects",
        ),
        OperationsTaskOut(
            key="threads",
            label="Connect Threads",
            done=threads_accounts_count > 0,
            detail=(
                f"{threads_accounts_count} Threads account(s) are connected."
                if threads_accounts_count > 0
                else "Create a Threads project and connect at least one account."
            ),
            href="/threads",
        ),
    ]

    analytics = [
        OperationsMetricOut(
            key="projects",
            label="Projects",
            value=len(project_ids),
            tone="neutral",
            hint="Accessible workspaces",
        ),
        OperationsMetricOut(
            key="sites",
            label="Sites",
            value=total_sites,
            tone="neutral",
            hint="Connected WordPress sites",
        ),
        OperationsMetricOut(
            key="running_jobs",
            label="Running Jobs",
            value=running_jobs,
            tone="neutral",
            hint="Currently active background work",
        ),
        OperationsMetricOut(
            key="published_recipes",
            label="Published Recipes",
            value=published_recipes,
            tone="success" if published_recipes > 0 else "neutral",
            hint="Content already sent to WordPress",
        ),
        OperationsMetricOut(
            key="failed_jobs_7d",
            label="Failed Jobs (7d)",
            value=failed_jobs_recent,
            tone="danger" if failed_jobs_recent > 0 else "success",
            hint="Fresh failures that need attention",
        ),
        OperationsMetricOut(
            key="scheduled_threads",
            label="Scheduled Threads",
            value=scheduled_threads_posts,
            tone="neutral",
            hint="Queued social posts",
        ),
    ]

    failures: list[OperationsFailureOut] = []

    if project_ids:
        failed_jobs = (
            await db.execute(
                select(Job)
                .where(
                    Job.project_id.in_(project_ids),
                    Job.status == JobStatus.failed,
                )
                .order_by(Job.created_at.desc())
                .limit(4)
            )
        ).scalars().all()
        for job in failed_jobs:
            failures.append(
                OperationsFailureOut(
                    kind="job",
                    id=str(job.id),
                    title=f"{project_names.get(job.project_id, 'Project')} job failed",
                    detail=_trim_detail(job.error, "The job failed without a stored error message."),
                    status=str(job.status.value if hasattr(job.status, "value") else job.status),
                    created_at=job.created_at,
                    href=f"/jobs/{job.id}",
                )
            )

        failed_recipe_rows = (
            await db.execute(
                select(Recipe, Site)
                .join(Site, Recipe.site_id == Site.id)
                .where(
                    Site.project_id.in_(project_ids),
                    Recipe.status == RecipeStatus.failed,
                )
                .order_by(Recipe.created_at.desc())
                .limit(4)
            )
        ).all()
        for recipe, site in failed_recipe_rows:
            failures.append(
                OperationsFailureOut(
                    kind="recipe",
                    id=str(recipe.id),
                    title=f"{site.domain} recipe failed",
                    detail=_trim_detail(
                        recipe.error_message,
                        "The recipe is marked as failed without a stored error message.",
                    ),
                    status=str(recipe.status.value if hasattr(recipe.status, "value") else recipe.status),
                    created_at=recipe.created_at,
                    href=f"/projects/{site.project_id}/sites/{site.id}",
                )
            )

        schedule_rows = (
            await db.execute(
                select(ProjectPublishSchedule, Project)
                .join(Project, ProjectPublishSchedule.project_id == Project.id)
                .where(
                    ProjectPublishSchedule.project_id.in_(project_ids),
                    ProjectPublishSchedule.last_error.is_not(None),
                    ProjectPublishSchedule.last_error != "",
                )
                .order_by(ProjectPublishSchedule.updated_at.desc())
                .limit(4)
            )
        ).all()
        for schedule, project in schedule_rows:
            failures.append(
                OperationsFailureOut(
                    kind="schedule",
                    id=str(schedule.project_id),
                    title=f"{project.name} schedule issue",
                    detail=_trim_detail(
                        schedule.last_error,
                        "The publish scheduler reported an error without details.",
                    ),
                    status="warning",
                    created_at=schedule.updated_at,
                    href=f"/projects/{project.id}",
                )
            )

    failed_threads = (
        await db.execute(
            select(ThreadsPost, ThreadsProject)
            .join(ThreadsProject, ThreadsPost.project_id == ThreadsProject.id)
            .where(
                ThreadsProject.owner_id == user.id,
                ThreadsPost.status == ThreadsPostStatus.failed,
            )
            .order_by(ThreadsPost.created_at.desc())
            .limit(4)
        )
    ).all()
    for post, threads_project in failed_threads:
        failures.append(
            OperationsFailureOut(
                kind="threads",
                id=str(post.id),
                title=f"{threads_project.name} Threads post failed",
                detail=_trim_detail(
                    post.error_message,
                    "The post failed without a stored Threads error message.",
                ),
                status=str(post.status.value if hasattr(post.status, "value") else post.status),
                created_at=post.created_at,
                href=f"/threads/{threads_project.id}",
            )
        )

    failures.sort(key=lambda item: item.created_at, reverse=True)

    return OperationsOverviewOut(
        analytics=analytics,
        monitoring=monitoring,
        onboarding=onboarding,
        failures=failures[:10],
    )
