from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import delete as sql_delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..crypto import decrypt, encrypt
from ..database import get_db
from ..db_models import (
    FacebookCommentMode,
    FacebookContent,
    FacebookContentStatus,
    FacebookDelivery,
    FacebookDeliveryStatus,
    FacebookGenerationLog,
    FacebookPage,
    FacebookProject,
    FacebookSpyRow,
    Project,
    Recipe,
    RecipeStatus,
    Site,
    User,
)
from ..dependencies import get_current_user
from ..services import facebook_api
from ..services.email_service import send_facebook_spy_sheet_low_email
from ..services.credentials_loader import load_credentials_for_job
from ..services.facebook_generation import facebook_generation_manager
from ..services.facebook_publisher import delete_facebook_content_files, publish_facebook_delivery
from ..services.facebook_video import validate_video_file
from ..services.facebook_schedule import (
    FacebookSchedulePolicy,
    generate_schedule_slots,
    validate_policy,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["facebook"])
UPLOADS_ROOT = Path(os.getenv("UPLOADS_DIR", "/app/uploads"))
FACEBOOK_SOURCE_DIR = UPLOADS_ROOT / "facebook" / "sources"
MAX_VIDEO_BYTES = 500 * 1024 * 1024
ALLOWED_VIDEO_TYPES = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
}


class FacebookProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)
    app_id: str = Field(min_length=1, max_length=255)
    app_secret: str = Field(min_length=1, max_length=1000)
    video_format: Literal["2:3", "9:16", "4:5", "1:1"] = "9:16"
    video_intro_seconds: float = Field(default=5.0, ge=1.0, le=15.0)
    video_fps: Literal[24, 30, 60] = 30
    video_bitrate_kbps: int = Field(default=8000, ge=1000, le=20000)


class FacebookProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    app_id: str | None = Field(default=None, max_length=255)
    app_secret: str | None = None
    video_format: Literal["2:3", "9:16", "4:5", "1:1"] | None = None
    video_intro_seconds: float | None = Field(default=None, ge=1.0, le=15.0)
    video_fps: Literal[24, 30, 60] | None = None
    video_bitrate_kbps: int | None = Field(default=None, ge=1000, le=20000)


class FacebookProjectOut(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    content_project_id: uuid.UUID
    name: str
    description: str
    app_id: str | None
    has_app_secret: bool
    video_format: str
    video_intro_seconds: float
    video_fps: int
    video_bitrate_kbps: int
    page_count: int
    content_count: int
    has_website: bool
    created_at: datetime


class FacebookPageOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    facebook_page_id: str
    name: str
    picture_url: str | None
    token_expires_at: datetime | None
    comment_mode: str
    publish_start_time: str
    publish_end_time: str
    max_posts_per_day: int
    interval_minutes: int
    timezone: str
    created_at: datetime

    @classmethod
    def from_db(cls, page: FacebookPage) -> "FacebookPageOut":
        return cls(
            id=page.id,
            project_id=page.project_id,
            facebook_page_id=page.facebook_page_id,
            name=page.name,
            picture_url=page.picture_url,
            token_expires_at=page.token_expires_at,
            comment_mode=page.comment_mode.value,
            publish_start_time=page.publish_start_time,
            publish_end_time=page.publish_end_time,
            max_posts_per_day=page.max_posts_per_day,
            interval_minutes=page.interval_minutes,
            timezone=page.timezone,
            created_at=page.created_at,
        )


class FacebookPageUpdate(BaseModel):
    comment_mode: Literal["full_recipe", "full_recipe_url"] | None = None
    publish_start_time: str | None = None
    publish_end_time: str | None = None
    max_posts_per_day: int | None = Field(default=None, ge=1, le=100)
    interval_minutes: int | None = Field(default=None, ge=1, le=1440)
    timezone: str | None = Field(default=None, max_length=64)


class FacebookPageTokenAdd(BaseModel):
    access_token: str = Field(min_length=20)
    comment_mode: Literal["full_recipe", "full_recipe_url"] = "full_recipe"


class FacebookPageHealthOut(BaseModel):
    status: Literal["healthy", "warning", "error"]
    token_valid: bool
    token_type: str | None = None
    app_matches: bool
    page_matches: bool
    permissions: list[str]
    missing_permissions: list[str]
    expires_at: datetime | None = None
    data_access_expires_at: datetime | None = None
    message: str


class FacebookOAuthCallbackBody(BaseModel):
    code: str
    state: str


class OAuthUrlOut(BaseModel):
    url: str


class FacebookSpyRowCreate(BaseModel):
    direct_link: str = Field(min_length=1, max_length=4000)
    post_title: str = Field(min_length=1, max_length=500)


class FacebookSpyRowUpdate(BaseModel):
    direct_link: str | None = Field(default=None, min_length=1, max_length=4000)
    post_title: str | None = Field(default=None, min_length=1, max_length=500)


class FacebookSpyRowOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    direct_link: str
    post_title: str
    created_at: datetime

    class Config:
        from_attributes = True


class FacebookGenerationStart(BaseModel):
    row_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)
    schedule: bool = False
    start_at: datetime | None = None
    page_ids: list[uuid.UUID] | None = None


class FacebookGenerationStartOut(BaseModel):
    content_ids: list[uuid.UUID]
    removed_rows: int
    remaining_rows: int
    low_queue_email_sent: bool


class FacebookGenerationRetryOut(BaseModel):
    content_id: uuid.UUID
    status: Literal["processing"]


class FacebookDeliveryOut(BaseModel):
    id: uuid.UUID
    page_id: uuid.UUID
    page_name: str
    status: str
    scheduled_at: datetime | None
    published_at: datetime | None
    facebook_post_id: str | None
    error_message: str | None


class FacebookContentOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    source_video_url: str
    screenshot_url: str | None
    processed_video_url: str | None
    generated_images: list[str]
    generated_article: str | None
    article_url: str | None
    status: str
    error_message: str | None
    created_at: datetime
    deliveries: list[FacebookDeliveryOut]


class FacebookDeliveryScheduleUpdate(BaseModel):
    scheduled_at: datetime | None = None


class FacebookDeliveryBulkPublish(BaseModel):
    delivery_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class FacebookDeliveryBulkPublishOut(BaseModel):
    queued_ids: list[uuid.UUID]
    skipped_ids: list[uuid.UUID]


class FacebookGenerationLogOut(BaseModel):
    id: int
    project_id: uuid.UUID
    content_id: uuid.UUID | None
    content_title: str | None
    content_status: str | None
    content_cancelled: bool
    level: str
    stage: str
    message: str
    created_at: datetime


class FacebookGenerationControlOut(BaseModel):
    state: Literal["idle", "running", "paused", "cancelling"]
    processing_count: int


class FacebookGenerationCancelOut(FacebookGenerationControlOut):
    restored_rows: int


async def _project(
    project_id: uuid.UUID, user: User, db: AsyncSession
) -> FacebookProject:
    row = await db.execute(
        select(FacebookProject).where(FacebookProject.id == project_id)
    )
    project = row.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Facebook project not found")
    if project.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Not the owner of this Facebook project")
    return project


async def _project_out(project: FacebookProject, db: AsyncSession) -> FacebookProjectOut:
    page_count = int(
        (
            await db.execute(
                select(func.count(FacebookPage.id)).where(FacebookPage.project_id == project.id)
            )
        ).scalar_one()
    )
    content_count = int(
        (
            await db.execute(
                select(func.count(FacebookContent.id)).where(
                    FacebookContent.project_id == project.id,
                    FacebookContent.generation_cancelled.is_(False),
                )
            )
        ).scalar_one()
    )
    has_website = (
        await db.execute(
            select(Site.id).where(Site.project_id == project.content_project_id).limit(1)
        )
    ).scalar_one_or_none() is not None
    return FacebookProjectOut(
        id=project.id,
        owner_id=project.owner_id,
        content_project_id=project.content_project_id,
        name=project.name,
        description=project.description or "",
        app_id=project.app_id or (settings.facebook_app_id or None),
        has_app_secret=bool(project.app_secret or settings.facebook_app_secret),
        video_format=project.video_format,
        video_intro_seconds=project.video_intro_seconds,
        video_fps=project.video_fps,
        video_bitrate_kbps=project.video_bitrate_kbps,
        page_count=page_count,
        content_count=content_count,
        has_website=has_website,
        created_at=project.created_at,
    )


async def _generation_control_out(
    project: FacebookProject, db: AsyncSession
) -> FacebookGenerationControlOut:
    processing_count = int(
        (
            await db.execute(
                select(func.count(FacebookContent.id)).where(
                    FacebookContent.project_id == project.id,
                    FacebookContent.status == FacebookContentStatus.processing,
                    FacebookContent.generation_cancelled.is_(False),
                )
            )
        ).scalar_one()
    )
    if facebook_generation_manager.is_cancelling(project.id):
        state = "cancelling"
    elif processing_count and project.generation_paused:
        state = "paused"
    elif processing_count:
        state = "running"
    else:
        state = "idle"
    return FacebookGenerationControlOut(
        state=state,
        processing_count=processing_count,
    )


async def _page(
    page_id: uuid.UUID, user: User, db: AsyncSession
) -> tuple[FacebookPage, FacebookProject]:
    row = await db.execute(
        select(FacebookPage, FacebookProject)
        .join(FacebookProject, FacebookProject.id == FacebookPage.project_id)
        .where(FacebookPage.id == page_id)
    )
    record = row.one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Facebook Page not found")
    page, project = record
    if project.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Not the owner of this Facebook project")
    return page, project


def _app_credentials(project: FacebookProject) -> tuple[str, str]:
    app_id = (project.app_id or settings.facebook_app_id or "").strip()
    if project.app_secret:
        try:
            app_secret = decrypt(project.app_secret)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Stored Facebook App Secret is invalid") from exc
    else:
        app_secret = (settings.facebook_app_secret or "").strip()
    if not app_id or not app_secret:
        raise HTTPException(
            status_code=400,
            detail="Configure Facebook App ID and App Secret before connecting Pages.",
        )
    return app_id, app_secret


@router.get("/facebook-projects", response_model=list[FacebookProjectOut])
async def list_facebook_projects(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    rows = await db.execute(
        select(FacebookProject)
        .where(FacebookProject.owner_id == user.id)
        .order_by(FacebookProject.created_at.desc())
    )
    return [await _project_out(project, db) for project in rows.scalars().all()]


@router.post(
    "/facebook-projects",
    response_model=FacebookProjectOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_facebook_project(
    body: FacebookProjectCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    content_project = Project(
        name=f"{body.name} - Facebook Content",
        description=body.description,
        owner_id=user.id,
    )
    db.add(content_project)
    await db.flush()
    project = FacebookProject(
        owner_id=user.id,
        content_project_id=content_project.id,
        name=body.name.strip(),
        description=body.description.strip(),
        app_id=body.app_id.strip(),
        app_secret=encrypt(body.app_secret.strip()),
        video_format=body.video_format,
        video_intro_seconds=body.video_intro_seconds,
        video_fps=body.video_fps,
        video_bitrate_kbps=body.video_bitrate_kbps,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return await _project_out(project, db)


@router.get("/facebook-projects/{project_id}", response_model=FacebookProjectOut)
async def get_facebook_project(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await _project_out(await _project(project_id, user, db), db)


@router.patch("/facebook-projects/{project_id}", response_model=FacebookProjectOut)
async def update_facebook_project(
    project_id: uuid.UUID,
    body: FacebookProjectUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = await _project(project_id, user, db)
    values = body.model_dump(exclude_unset=True)
    app_secret = values.pop("app_secret", None)
    for key, value in values.items():
        setattr(project, key, value.strip() if isinstance(value, str) else value)
    if app_secret:
        project.app_secret = encrypt(app_secret.strip())
    content_project = (
        await db.execute(select(Project).where(Project.id == project.content_project_id))
    ).scalar_one()
    if body.name is not None:
        content_project.name = f"{body.name.strip()} - Facebook Content"
    if body.description is not None:
        content_project.description = body.description.strip()
    await db.commit()
    await db.refresh(project)
    return await _project_out(project, db)


@router.delete("/facebook-projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_facebook_project(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = await _project(project_id, user, db)
    content_project_id = project.content_project_id
    await db.delete(project)
    await db.flush()
    content_project = (
        await db.execute(select(Project).where(Project.id == content_project_id))
    ).scalar_one_or_none()
    if content_project is not None:
        await db.delete(content_project)
    await db.commit()


@router.get(
    "/facebook-projects/{project_id}/pages", response_model=list[FacebookPageOut]
)
async def list_facebook_pages(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _project(project_id, user, db)
    rows = await db.execute(
        select(FacebookPage)
        .where(FacebookPage.project_id == project_id)
        .order_by(FacebookPage.created_at.asc())
    )
    return [FacebookPageOut.from_db(page) for page in rows.scalars().all()]


def _facebook_epoch(value: int) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromtimestamp(value, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


@router.get("/facebook-pages/{page_id}/health", response_model=FacebookPageHealthOut)
async def get_facebook_page_health(
    page_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    page, project = await _page(page_id, user, db)
    app_id, app_secret = _app_credentials(project)
    try:
        diagnostic = await asyncio.to_thread(
            facebook_api.inspect_page_connection,
            page_access_token=decrypt(page.access_token),
            app_id=app_id,
            app_secret=app_secret,
            expected_page_id=page.facebook_page_id,
        )
    except Exception as exc:
        # Return a structured result so the Settings UI can explain an expired,
        # revoked, mismatched, or otherwise unreadable token in one place.
        logger.warning("Facebook Page health check failed for %s: %s", page.id, exc)
        return FacebookPageHealthOut(
            status="error",
            token_valid=False,
            app_matches=False,
            page_matches=False,
            permissions=[],
            missing_permissions=sorted(facebook_api.REQUIRED_PAGE_PERMISSIONS),
            message=str(exc)[:500],
        )

    expires_at = _facebook_epoch(diagnostic["expires_at"])
    data_access_expires_at = _facebook_epoch(diagnostic["data_access_expires_at"])
    errors: list[str] = []
    if not diagnostic["token_valid"]:
        errors.append("The Page access token is invalid or revoked.")
    if not diagnostic["app_matches"]:
        errors.append("The token was issued for a different Meta application.")
    if not diagnostic["page_matches"]:
        errors.append("The token belongs to a different Facebook Page.")
    if diagnostic["missing_permissions"]:
        errors.append(
            "Missing permissions: " + ", ".join(diagnostic["missing_permissions"]) + "."
        )

    current_time = datetime.now(timezone.utc)
    warning = None
    effective_expiry = expires_at or data_access_expires_at
    if not errors and effective_expiry and effective_expiry <= current_time + timedelta(days=7):
        warning = "The Facebook authorization expires within seven days. Reconnect the Page."

    return FacebookPageHealthOut(
        status="error" if errors else "warning" if warning else "healthy",
        token_valid=diagnostic["token_valid"],
        token_type=diagnostic["token_type"] or None,
        app_matches=diagnostic["app_matches"],
        page_matches=diagnostic["page_matches"],
        permissions=diagnostic["permissions"],
        missing_permissions=diagnostic["missing_permissions"],
        expires_at=expires_at,
        data_access_expires_at=data_access_expires_at,
        message=(
            " ".join(errors)
            if errors
            else warning
            or "The Page token, Meta app, Page identity, and required permissions are valid."
        ),
    )


@router.get("/facebook/oauth/url", response_model=OAuthUrlOut)
async def facebook_oauth_url(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    comment_mode: Literal["full_recipe", "full_recipe_url"] = Query(default="full_recipe"),
):
    project = await _project(project_id, user, db)
    app_id, _app_secret = _app_credentials(project)
    state = jwt.encode(
        {
            "facebook_project_id": str(project.id),
            "user_id": str(user.id),
            "comment_mode": comment_mode,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    return OAuthUrlOut(
        url=facebook_api.get_oauth_url(
            app_id=app_id,
            redirect_uri=settings.facebook_redirect_uri,
            state=state,
        )
    )


@router.post(
    "/facebook/oauth/callback",
    response_model=list[FacebookPageOut],
    status_code=status.HTTP_201_CREATED,
)
async def facebook_oauth_callback(
    body: FacebookOAuthCallbackBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    try:
        state = jwt.decode(
            body.state, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
        project_id = uuid.UUID(state["facebook_project_id"])
        if uuid.UUID(state["user_id"]) != user.id:
            raise ValueError("OAuth state user mismatch")
        mode = FacebookCommentMode(state.get("comment_mode", "full_recipe"))
    except (JWTError, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired Facebook OAuth state") from exc
    project = await _project(project_id, user, db)
    app_id, app_secret = _app_credentials(project)
    try:
        token_data = facebook_api.exchange_code_for_user_token(
            code=body.code,
            app_id=app_id,
            app_secret=app_secret,
            redirect_uri=settings.facebook_redirect_uri,
        )
        token_data = facebook_api.exchange_for_long_lived_user_token(
            access_token=token_data["access_token"],
            app_id=app_id,
            app_secret=app_secret,
        )
        managed_pages = facebook_api.get_managed_pages(token_data["access_token"])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not managed_pages:
        raise HTTPException(
            status_code=400,
            detail="No manageable Facebook Pages were returned for this account.",
        )
    output: list[FacebookPage] = []
    token_expires_at = None
    if token_data.get("expires_in"):
        token_expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=int(token_data["expires_in"])
        )
    for page_data in managed_pages:
        existing = (
            await db.execute(
                select(FacebookPage).where(
                    FacebookPage.project_id == project.id,
                    FacebookPage.facebook_page_id == page_data["id"],
                )
            )
        ).scalar_one_or_none()
        if existing:
            existing.name = page_data["name"]
            existing.picture_url = page_data["picture_url"]
            existing.access_token = encrypt(page_data["access_token"])
            existing.comment_mode = mode
            existing.token_expires_at = token_expires_at
            page = existing
        else:
            page = FacebookPage(
                project_id=project.id,
                facebook_page_id=page_data["id"],
                name=page_data["name"],
                picture_url=page_data["picture_url"],
                access_token=encrypt(page_data["access_token"]),
                token_expires_at=token_expires_at,
                comment_mode=mode,
            )
            db.add(page)
        output.append(page)
    await db.commit()
    for page in output:
        await db.refresh(page)
    return [FacebookPageOut.from_db(page) for page in output]


@router.post(
    "/facebook-projects/{project_id}/pages/token",
    response_model=FacebookPageOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_facebook_page_by_token(
    project_id: uuid.UUID,
    body: FacebookPageTokenAdd,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = await _project(project_id, user, db)
    try:
        page_data = facebook_api.inspect_page_token(body.access_token.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not page_data["id"]:
        raise HTTPException(status_code=400, detail="Token does not identify a Facebook Page")
    page = (
        await db.execute(
            select(FacebookPage).where(
                FacebookPage.project_id == project.id,
                FacebookPage.facebook_page_id == page_data["id"],
            )
        )
    ).scalar_one_or_none()
    if page is None:
        page = FacebookPage(
            project_id=project.id,
            facebook_page_id=page_data["id"],
            name=page_data["name"],
            picture_url=page_data["picture_url"],
            access_token=encrypt(body.access_token.strip()),
            comment_mode=FacebookCommentMode(body.comment_mode),
        )
        db.add(page)
    else:
        page.name = page_data["name"]
        page.picture_url = page_data["picture_url"]
        page.access_token = encrypt(body.access_token.strip())
        page.comment_mode = FacebookCommentMode(body.comment_mode)
    await db.commit()
    await db.refresh(page)
    return FacebookPageOut.from_db(page)


@router.patch("/facebook-pages/{page_id}", response_model=FacebookPageOut)
async def update_facebook_page(
    page_id: uuid.UUID,
    body: FacebookPageUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    page, _project_row = await _page(page_id, user, db)
    values = body.model_dump(exclude_unset=True)
    policy = FacebookSchedulePolicy(
        start_time=values.get("publish_start_time", page.publish_start_time),
        end_time=values.get("publish_end_time", page.publish_end_time),
        max_posts_per_day=values.get("max_posts_per_day", page.max_posts_per_day),
        interval_minutes=values.get("interval_minutes", page.interval_minutes),
        timezone_name=values.get("timezone", page.timezone),
    )
    try:
        validate_policy(policy)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    for key, value in values.items():
        if key == "comment_mode":
            value = FacebookCommentMode(value)
        setattr(page, key, value)
    await db.commit()
    await db.refresh(page)
    return FacebookPageOut.from_db(page)


@router.delete("/facebook-pages/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_facebook_page(
    page_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    page, _project_row = await _page(page_id, user, db)
    await db.delete(page)
    await db.commit()


@router.get(
    "/facebook-projects/{project_id}/spy-sheet",
    response_model=list[FacebookSpyRowOut],
)
async def list_facebook_spy_rows(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _project(project_id, user, db)
    rows = await db.execute(
        select(FacebookSpyRow)
        .where(FacebookSpyRow.project_id == project_id)
        .order_by(FacebookSpyRow.created_at.asc())
    )
    return rows.scalars().all()


@router.post(
    "/facebook-projects/{project_id}/spy-sheet",
    response_model=FacebookSpyRowOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_facebook_spy_row(
    project_id: uuid.UUID,
    body: FacebookSpyRowCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _project(project_id, user, db)
    row = FacebookSpyRow(
        project_id=project_id,
        direct_link=body.direct_link.strip(),
        post_title=body.post_title.strip(),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.patch("/facebook-spy-rows/{row_id}", response_model=FacebookSpyRowOut)
async def update_facebook_spy_row(
    row_id: uuid.UUID,
    body: FacebookSpyRowUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    row = (
        await db.execute(select(FacebookSpyRow).where(FacebookSpyRow.id == row_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Spy Sheet row not found")
    await _project(row.project_id, user, db)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(row, key, value.strip())
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/facebook-spy-rows/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_facebook_spy_row(
    row_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    row = (
        await db.execute(select(FacebookSpyRow).where(FacebookSpyRow.id == row_id))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Spy Sheet row not found")
    await _project(row.project_id, user, db)
    await db.delete(row)
    await db.commit()


async def _store_facebook_video_upload(file: UploadFile) -> tuple[str, Path]:
    content_type = (file.content_type or "").lower()
    extension = ALLOWED_VIDEO_TYPES.get(content_type)
    if not extension:
        raise HTTPException(status_code=400, detail="Upload an MP4, MOV, or WebM video.")
    FACEBOOK_SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    destination = FACEBOOK_SOURCE_DIR / f"{uuid.uuid4()}{extension}"
    written = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_VIDEO_BYTES:
                    raise HTTPException(status_code=413, detail="Video exceeds the 500 MB limit.")
                output.write(chunk)
        try:
            await asyncio.to_thread(validate_video_file, destination)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    url = f"{settings.server_base_url.rstrip('/')}/uploads/facebook/sources/{destination.name}"
    return url, destination


@router.post("/facebook/upload-video")
async def upload_facebook_video(
    file: Annotated[UploadFile, File(...)],
    user: Annotated[User, Depends(get_current_user)],
):
    del user
    url, _destination = await _store_facebook_video_upload(file)
    return {"url": url}


@router.get(
    "/facebook-projects/{project_id}/generation-control",
    response_model=FacebookGenerationControlOut,
)
async def get_facebook_generation_control(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = await _project(project_id, user, db)
    return await _generation_control_out(project, db)


@router.post(
    "/facebook-projects/{project_id}/generation-control/pause",
    response_model=FacebookGenerationControlOut,
)
async def pause_facebook_generation(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = await _project(project_id, user, db)
    control = await _generation_control_out(project, db)
    if control.processing_count == 0:
        project.generation_paused = False
        await db.commit()
        facebook_generation_manager.resume(project.id)
        return FacebookGenerationControlOut(state="idle", processing_count=0)

    facebook_generation_manager.pause(project.id)
    try:
        project.generation_paused = True
        db.add(
            FacebookGenerationLog(
                project_id=project.id,
                level="warning",
                stage="paused",
                message=(
                    "Generation stop requested. Active work will pause at the next safe checkpoint."
                ),
            )
        )
        await db.commit()
    except Exception:
        facebook_generation_manager.resume(project.id)
        raise
    await db.refresh(project)
    return await _generation_control_out(project, db)


@router.post(
    "/facebook-projects/{project_id}/generation-control/resume",
    response_model=FacebookGenerationControlOut,
)
async def resume_facebook_generation(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = await _project(project_id, user, db)
    if facebook_generation_manager.is_cancelling(project.id):
        raise HTTPException(
            status_code=409,
            detail="Cancellation is still finishing. Wait before continuing generation.",
        )

    project.generation_paused = False
    db.add(
        FacebookGenerationLog(
            project_id=project.id,
            level="info",
            stage="resumed",
            message="Generation continued.",
        )
    )
    pending_rows = await db.execute(
        select(FacebookContent.id).where(
            FacebookContent.project_id == project.id,
            FacebookContent.status == FacebookContentStatus.processing,
            FacebookContent.generation_cancelled.is_(False),
        )
    )
    pending_ids = list(pending_rows.scalars().all())
    await db.commit()
    facebook_generation_manager.resume(project.id)
    if pending_ids:
        await facebook_generation_manager.start_batch(
            facebook_project_id=project.id,
            content_ids=pending_ids,
            created_by=user.id,
        )
    await db.refresh(project)
    return await _generation_control_out(project, db)


@router.post(
    "/facebook-projects/{project_id}/generation-control/cancel",
    response_model=FacebookGenerationCancelOut,
)
async def cancel_facebook_generation(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = await _project(project_id, user, db)
    if not project.generation_paused:
        raise HTTPException(
            status_code=409,
            detail="Stop the generation before cancelling it.",
        )

    facebook_generation_manager.cancel(project.id)
    try:
        pending_rows = await db.execute(
            select(FacebookContent)
            .where(
                FacebookContent.project_id == project.id,
                FacebookContent.status == FacebookContentStatus.processing,
                FacebookContent.generation_cancelled.is_(False),
            )
            .order_by(FacebookContent.created_at.asc())
            .with_for_update()
        )
        pending = list(pending_rows.scalars().all())
        for content in pending:
            db.add(
                FacebookSpyRow(
                    project_id=project.id,
                    direct_link=content.source_video_url,
                    post_title=content.title,
                )
            )
            content.generation_cancelled = True
            content.status = FacebookContentStatus.failed
            content.error_message = (
                "Generation cancelled; the source was returned to Spy Sheet."
            )
            db.add(
                FacebookGenerationLog(
                    project_id=project.id,
                    content_id=content.id,
                    level="warning",
                    stage="cancelled",
                    message="Generation cancelled; source returned to Spy Sheet.",
                )
            )
        if pending:
            await db.execute(
                update(FacebookDelivery)
                .where(
                    FacebookDelivery.content_id.in_([content.id for content in pending]),
                    FacebookDelivery.status == FacebookDeliveryStatus.processing,
                )
                .values(
                    status=FacebookDeliveryStatus.failed,
                    error_message="Generation cancelled; source returned to Spy Sheet.",
                )
            )
            recipe_ids = [
                content.recipe_id
                for content in pending
                if getattr(content, "recipe_id", None) is not None
            ]
            if recipe_ids:
                await db.execute(
                    update(Recipe)
                    .where(
                        Recipe.id.in_(recipe_ids),
                        Recipe.status == RecipeStatus.generating,
                    )
                    .values(
                        status=RecipeStatus.failed,
                        error_message="Facebook generation was cancelled by the user.",
                    )
                )
        project.generation_paused = False
        await db.commit()
    except Exception:
        facebook_generation_manager.reset_cancel(project.id)
        raise

    control = await _generation_control_out(project, db)
    return FacebookGenerationCancelOut(
        state=control.state,
        processing_count=control.processing_count,
        restored_rows=len(pending),
    )


@router.post(
    "/facebook-projects/{project_id}/generate",
    response_model=FacebookGenerationStartOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_facebook_generation(
    project_id: uuid.UUID,
    body: FacebookGenerationStart,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = await _project(project_id, user, db)
    if facebook_generation_manager.is_cancelling(project.id):
        raise HTTPException(
            status_code=409,
            detail="The previous cancellation is still finishing. Try again in a moment.",
        )
    existing_processing = int(
        (
            await db.execute(
                select(func.count(FacebookContent.id)).where(
                    FacebookContent.project_id == project.id,
                    FacebookContent.status == FacebookContentStatus.processing,
                    FacebookContent.generation_cancelled.is_(False),
                )
            )
        ).scalar_one()
    )
    if project.generation_paused and existing_processing:
        raise HTTPException(
            status_code=409,
            detail="Continue or cancel the stopped generation before starting another batch.",
        )
    if project.generation_paused:
        project.generation_paused = False
        facebook_generation_manager.resume(project.id)
    site = (
        await db.execute(
            select(Site).where(Site.project_id == project.content_project_id).limit(1)
        )
    ).scalar_one_or_none()
    if site is None:
        raise HTTPException(status_code=400, detail="Configure the website before generation.")
    credentials = await load_credentials_for_job(db, project.content_project_id, user.id)
    if not credentials.get("openai"):
        raise HTTPException(
            status_code=400,
            detail="Configure an OpenAI API key before starting Facebook generation.",
        )

    page_query = select(FacebookPage).where(FacebookPage.project_id == project.id)
    requested_page_ids = set(body.page_ids or [])
    if body.page_ids is not None:
        page_query = page_query.where(FacebookPage.id.in_(requested_page_ids))
    pages = list((await db.execute(page_query.order_by(FacebookPage.created_at.asc()))).scalars())
    if body.page_ids is not None and len(pages) != len(requested_page_ids):
        raise HTTPException(
            status_code=404,
            detail="One or more selected Facebook Pages were not found in this project.",
        )
    if not pages:
        raise HTTPException(status_code=400, detail="Select at least one connected Facebook Page.")

    selected_rows = list(
        (
            await db.execute(
                select(FacebookSpyRow)
                .where(
                    FacebookSpyRow.project_id == project.id,
                    FacebookSpyRow.id.in_(body.row_ids),
                )
                .order_by(FacebookSpyRow.created_at.asc())
            )
        ).scalars()
    )
    if len(selected_rows) != len(set(body.row_ids)):
        raise HTTPException(status_code=404, detail="One or more selected Spy Sheet rows were not found.")

    schedule_map: dict[uuid.UUID, list[datetime | None]] = {}
    if body.schedule:
        now = datetime.now(timezone.utc)
        requested_start = body.start_at or now
        if requested_start.tzinfo is None:
            requested_start = requested_start.replace(tzinfo=timezone.utc)
        else:
            requested_start = requested_start.astimezone(timezone.utc)
        requested_start = max(requested_start, now)
        for page in pages:
            existing_rows = (
                await db.execute(
                    select(
                        FacebookDelivery.scheduled_at,
                        FacebookDelivery.published_at,
                    ).where(
                        FacebookDelivery.page_id == page.id,
                        FacebookDelivery.status.in_(
                            [
                                FacebookDeliveryStatus.scheduled,
                                FacebookDeliveryStatus.published,
                            ]
                        ),
                    )
                )
            ).all()
            existing = [
                scheduled_at or published_at
                for scheduled_at, published_at in existing_rows
                if scheduled_at or published_at
            ]
            try:
                schedule_map[page.id] = generate_schedule_slots(
                    start_at=requested_start,
                    count=len(selected_rows),
                    policy=FacebookSchedulePolicy(
                        start_time=page.publish_start_time,
                        end_time=page.publish_end_time,
                        max_posts_per_day=page.max_posts_per_day,
                        interval_minutes=page.interval_minutes,
                        timezone_name=page.timezone,
                    ),
                    existing=existing,
                )
            except ValueError as exc:
                raise HTTPException(
                    status_code=400, detail=f"{page.name}: {exc}"
                ) from exc
    else:
        schedule_map = {page.id: [None] * len(selected_rows) for page in pages}

    contents: list[FacebookContent] = []
    for index, spy_row in enumerate(selected_rows):
        content = FacebookContent(
            project_id=project.id,
            created_by=user.id,
            source_video_url=spy_row.direct_link,
            title=spy_row.post_title,
        )
        db.add(content)
        await db.flush()
        contents.append(content)
        db.add(
            FacebookGenerationLog(
                project_id=project.id,
                content_id=content.id,
                level="info",
                stage="queue",
                message=f'Queued generation for "{spy_row.post_title}".',
            )
        )
        for page in pages:
            db.add(
                FacebookDelivery(
                    content_id=content.id,
                    page_id=page.id,
                    status=FacebookDeliveryStatus.processing,
                    scheduled_at=schedule_map[page.id][index],
                )
            )

    await db.execute(
        sql_delete(FacebookSpyRow).where(FacebookSpyRow.id.in_([row.id for row in selected_rows]))
    )
    remaining_rows = int(
        (
            await db.execute(
                select(func.count(FacebookSpyRow.id)).where(
                    FacebookSpyRow.project_id == project.id
                )
            )
        ).scalar_one()
    )
    await db.commit()

    low_queue_email_sent = remaining_rows <= 2
    if low_queue_email_sent:
        try:
            await send_facebook_spy_sheet_low_email(
                user.email, user.full_name, project.name, remaining_rows
            )
        except Exception:
            logger.exception("Failed to send Facebook Spy Sheet low-queue email")
            low_queue_email_sent = False

    content_ids = [content.id for content in contents]
    await facebook_generation_manager.start_batch(
        facebook_project_id=project.id,
        content_ids=content_ids,
        created_by=user.id,
    )
    return FacebookGenerationStartOut(
        content_ids=content_ids,
        removed_rows=len(selected_rows),
        remaining_rows=remaining_rows,
        low_queue_email_sent=low_queue_email_sent,
    )


@router.get(
    "/facebook-projects/{project_id}/contents",
    response_model=list[FacebookContentOut],
)
async def list_facebook_contents(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _project(project_id, user, db)
    contents = list(
        (
            await db.execute(
                select(FacebookContent)
                .where(
                    FacebookContent.project_id == project_id,
                    FacebookContent.generation_cancelled.is_(False),
                )
                .order_by(FacebookContent.created_at.desc())
            )
        ).scalars()
    )
    if not contents:
        return []
    delivery_rows = await db.execute(
        select(FacebookDelivery, FacebookPage.name)
        .join(FacebookPage, FacebookPage.id == FacebookDelivery.page_id)
        .where(FacebookDelivery.content_id.in_([content.id for content in contents]))
        .order_by(FacebookDelivery.created_at.asc())
    )
    by_content: dict[uuid.UUID, list[FacebookDeliveryOut]] = {}
    for delivery, page_name in delivery_rows.all():
        by_content.setdefault(delivery.content_id, []).append(
            FacebookDeliveryOut(
                id=delivery.id,
                page_id=delivery.page_id,
                page_name=page_name,
                status=delivery.status.value,
                scheduled_at=delivery.scheduled_at,
                published_at=delivery.published_at,
                facebook_post_id=delivery.facebook_post_id,
                error_message=delivery.error_message,
            )
        )
    output: list[FacebookContentOut] = []
    for content in contents:
        try:
            images = json.loads(content.generated_images or "[]")
            if not isinstance(images, list):
                images = []
        except json.JSONDecodeError:
            images = []
        output.append(
            FacebookContentOut(
                id=content.id,
                project_id=content.project_id,
                title=content.title,
                source_video_url=content.source_video_url,
                screenshot_url=content.screenshot_url,
                processed_video_url=content.processed_video_url,
                generated_images=[str(item) for item in images if item],
                generated_article=content.generated_article,
                article_url=content.article_url,
                status=content.status.value,
                error_message=content.error_message,
                created_at=content.created_at,
                deliveries=by_content.get(content.id, []),
            )
        )
    return output


@router.delete(
    "/facebook-contents/{content_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_facebook_content(
    content_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    content = (
        await db.execute(
            select(FacebookContent)
            .where(FacebookContent.id == content_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if content is None:
        raise HTTPException(status_code=404, detail="Facebook content not found")
    await _project(content.project_id, user, db)
    if facebook_generation_manager.is_running(content.id):
        raise HTTPException(
            status_code=409,
            detail="Stop this generation before deleting it.",
        )
    if content.status not in {
        FacebookContentStatus.ready,
        FacebookContentStatus.failed,
    }:
        raise HTTPException(
            status_code=409,
            detail="Only a successful or failed generation can be deleted.",
        )
    publishing_count = int(
        (
            await db.execute(
                select(func.count(FacebookDelivery.id)).where(
                    FacebookDelivery.content_id == content.id,
                    FacebookDelivery.status == FacebookDeliveryStatus.publishing,
                )
            )
        ).scalar_one()
    )
    if publishing_count:
        raise HTTPException(
            status_code=409,
            detail="A Facebook publication is currently running. Try again shortly.",
        )

    source_video_url = content.source_video_url
    processed_video_url = content.processed_video_url
    recipe_id = content.recipe_id
    other_content_references = int(
        (
            await db.execute(
                select(func.count(FacebookContent.id)).where(
                    FacebookContent.id != content.id,
                    FacebookContent.source_video_url == source_video_url,
                )
            )
        ).scalar_one()
    )
    spy_sheet_references = int(
        (
            await db.execute(
                select(func.count(FacebookSpyRow.id)).where(
                    FacebookSpyRow.direct_link == source_video_url
                )
            )
        ).scalar_one()
    )
    delete_source = other_content_references == 0 and spy_sheet_references == 0

    await db.execute(
        sql_delete(FacebookGenerationLog).where(
            FacebookGenerationLog.content_id == content.id
        )
    )
    await db.delete(content)
    await db.flush()
    if recipe_id is not None:
        recipe = (
            await db.execute(select(Recipe).where(Recipe.id == recipe_id))
        ).scalar_one_or_none()
        if recipe is not None:
            await db.delete(recipe)
    await db.commit()

    deleted_count, deleted_bytes, failures = await asyncio.to_thread(
        delete_facebook_content_files,
        content_id,
        source_video_url=source_video_url,
        processed_video_url=processed_video_url,
        delete_source=delete_source,
    )
    if failures:
        logger.warning(
            "Deleted Facebook content %s but could not remove assets: %s",
            content_id,
            ", ".join(failures),
        )
    else:
        logger.info(
            "Deleted Facebook content %s and %s local file(s), freeing %.1f MB",
            content_id,
            deleted_count,
            deleted_bytes / (1024 * 1024),
        )


async def _queue_facebook_generation_retry(
    content_id: uuid.UUID,
    user: User,
    db: AsyncSession,
    *,
    replacement_source_url: str | None = None,
) -> FacebookGenerationRetryOut:
    content = (
        await db.execute(
            select(FacebookContent)
            .where(FacebookContent.id == content_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if content is None:
        raise HTTPException(status_code=404, detail="Facebook content not found")
    project = await _project(content.project_id, user, db)
    if content.generation_cancelled:
        raise HTTPException(
            status_code=409,
            detail="This source was cancelled and already returned to Spy Sheet.",
        )
    if content.status != FacebookContentStatus.failed:
        raise HTTPException(
            status_code=409,
            detail="Only a failed generation can be retried.",
        )
    if facebook_generation_manager.is_running(content.id):
        raise HTTPException(
            status_code=409,
            detail="The failed worker is still closing. Retry again in a moment.",
        )
    if project.generation_paused or facebook_generation_manager.is_cancelling(project.id):
        raise HTTPException(
            status_code=409,
            detail="Continue or finish cancelling the current generation first.",
        )

    previous_recipe_id = content.recipe_id
    if replacement_source_url is not None:
        content.source_video_url = replacement_source_url
    content.recipe_id = None
    content.screenshot_url = None
    content.processed_video_url = None
    content.generated_images = None
    content.generated_article = None
    content.article_url = None
    content.status = FacebookContentStatus.processing
    content.error_message = None
    await db.execute(
        update(FacebookDelivery)
        .where(FacebookDelivery.content_id == content.id)
        .values(
            status=FacebookDeliveryStatus.processing,
            published_at=None,
            facebook_post_id=None,
            first_comment_id=None,
            error_message=None,
        )
    )
    if previous_recipe_id is not None:
        await db.flush()
        await db.execute(
            sql_delete(Recipe).where(
                Recipe.id == previous_recipe_id,
                Recipe.status.in_([RecipeStatus.generating, RecipeStatus.failed]),
            )
        )
    db.add(
        FacebookGenerationLog(
            project_id=project.id,
            content_id=content.id,
            level="info",
            stage="retry",
            message=(
                "Source video replaced and generation retry queued."
                if replacement_source_url is not None
                else "Generation retry queued."
            ),
        )
    )
    await db.commit()

    await facebook_generation_manager.start_batch(
        facebook_project_id=project.id,
        content_ids=[content.id],
        created_by=user.id,
    )
    return FacebookGenerationRetryOut(content_id=content.id, status="processing")


@router.post(
    "/facebook-contents/{content_id}/retry",
    response_model=FacebookGenerationRetryOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def retry_facebook_generation(
    content_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await _queue_facebook_generation_retry(content_id, user, db)


@router.post(
    "/facebook-contents/{content_id}/replace-video-and-retry",
    response_model=FacebookGenerationRetryOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def replace_facebook_video_and_retry(
    content_id: uuid.UUID,
    file: Annotated[UploadFile, File(...)],
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Reject unauthorized/non-failed content before accepting a potentially
    # large upload. The locked retry path repeats every state check afterward.
    content = (
        await db.execute(select(FacebookContent).where(FacebookContent.id == content_id))
    ).scalar_one_or_none()
    if content is None:
        raise HTTPException(status_code=404, detail="Facebook content not found")
    await _project(content.project_id, user, db)
    if content.generation_cancelled or content.status != FacebookContentStatus.failed:
        raise HTTPException(
            status_code=409,
            detail="Only an active failed generation can replace its source video.",
        )
    # Do not hold an idle database transaction while a large file is uploaded.
    await db.rollback()

    source_url, destination = await _store_facebook_video_upload(file)
    try:
        return await _queue_facebook_generation_retry(
            content_id,
            user,
            db,
            replacement_source_url=source_url,
        )
    except HTTPException:
        # A concurrent retry/pause can invalidate the operation after upload.
        # This file is not referenced by content yet, so it is safe to remove.
        destination.unlink(missing_ok=True)
        raise


@router.get(
    "/facebook-projects/{project_id}/logs",
    response_model=list[FacebookGenerationLogOut],
)
async def list_facebook_generation_logs(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    level: Literal["info", "success", "warning", "error"] | None = None,
    content_id: uuid.UUID | None = None,
    limit: int = Query(default=500, ge=1, le=1000),
):
    await _project(project_id, user, db)
    query = (
        select(
            FacebookGenerationLog,
            FacebookContent.title,
            FacebookContent.status,
            FacebookContent.generation_cancelled,
        )
        .outerjoin(FacebookContent, FacebookContent.id == FacebookGenerationLog.content_id)
        .where(FacebookGenerationLog.project_id == project_id)
    )
    if level:
        query = query.where(FacebookGenerationLog.level == level)
    if content_id:
        query = query.where(FacebookGenerationLog.content_id == content_id)
    rows = await db.execute(
        query.order_by(FacebookGenerationLog.created_at.desc(), FacebookGenerationLog.id.desc())
        .limit(limit)
    )
    return [
        FacebookGenerationLogOut(
            id=entry.id,
            project_id=entry.project_id,
            content_id=entry.content_id,
            content_title=content_title,
            content_status=content_status.value if content_status else None,
            content_cancelled=bool(content_cancelled),
            level=entry.level,
            stage=entry.stage,
            message=entry.message,
            created_at=entry.created_at,
        )
        for entry, content_title, content_status, content_cancelled in rows.all()
    ]


@router.patch(
    "/facebook-deliveries/{delivery_id}/schedule", response_model=FacebookDeliveryOut
)
async def schedule_facebook_delivery(
    delivery_id: uuid.UUID,
    body: FacebookDeliveryScheduleUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    row = await db.execute(
        select(FacebookDelivery, FacebookContent, FacebookPage, FacebookProject)
        .join(FacebookContent, FacebookContent.id == FacebookDelivery.content_id)
        .join(FacebookPage, FacebookPage.id == FacebookDelivery.page_id)
        .join(FacebookProject, FacebookProject.id == FacebookContent.project_id)
        .where(FacebookDelivery.id == delivery_id)
    )
    record = row.one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="Facebook delivery not found")
    delivery, content, page, project = record
    if project.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Not the owner of this Facebook project")
    if content.status.value != "ready":
        raise HTTPException(status_code=400, detail="Content generation is not complete.")
    if delivery.status not in {
        FacebookDeliveryStatus.draft,
        FacebookDeliveryStatus.scheduled,
        FacebookDeliveryStatus.failed,
    }:
        raise HTTPException(
            status_code=409,
            detail="Only a ready, scheduled, or failed publication can be rescheduled.",
        )
    delivery.scheduled_at = body.scheduled_at
    delivery.status = (
        FacebookDeliveryStatus.scheduled
        if body.scheduled_at is not None
        else FacebookDeliveryStatus.draft
    )
    delivery.error_message = None
    await db.commit()
    await db.refresh(delivery)
    return FacebookDeliveryOut(
        id=delivery.id,
        page_id=page.id,
        page_name=page.name,
        status=delivery.status.value,
        scheduled_at=delivery.scheduled_at,
        published_at=delivery.published_at,
        facebook_post_id=delivery.facebook_post_id,
        error_message=delivery.error_message,
    )


@router.post(
    "/facebook-deliveries/publish-bulk",
    response_model=FacebookDeliveryBulkPublishOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def publish_facebook_deliveries_bulk(
    body: FacebookDeliveryBulkPublish,
    background_tasks: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # Preserve the caller's order while preventing duplicate tasks for the same
    # Page delivery.
    delivery_ids = list(dict.fromkeys(body.delivery_ids))
    rows = (
        await db.execute(
            select(FacebookDelivery.id, FacebookProject.owner_id)
            .join(FacebookContent, FacebookContent.id == FacebookDelivery.content_id)
            .join(FacebookProject, FacebookProject.id == FacebookContent.project_id)
            .where(FacebookDelivery.id.in_(delivery_ids))
        )
    ).all()
    if len(rows) != len(delivery_ids):
        raise HTTPException(
            status_code=404,
            detail="One or more Facebook publications were not found.",
        )
    if any(owner_id != user.id for _delivery_id, owner_id in rows):
        raise HTTPException(
            status_code=403,
            detail="Not the owner of one or more Facebook publications.",
        )

    claimed = await db.execute(
        update(FacebookDelivery)
        .where(
            FacebookDelivery.id.in_(delivery_ids),
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
    queued_set = set(claimed.scalars().all())
    await db.commit()

    queued_ids = [delivery_id for delivery_id in delivery_ids if delivery_id in queued_set]
    skipped_ids = [delivery_id for delivery_id in delivery_ids if delivery_id not in queued_set]
    for delivery_id in queued_ids:
        background_tasks.add_task(
            publish_facebook_delivery,
            delivery_id,
            already_claimed=True,
        )
    return FacebookDeliveryBulkPublishOut(
        queued_ids=queued_ids,
        skipped_ids=skipped_ids,
    )


@router.post(
    "/facebook-deliveries/{delivery_id}/publish",
    status_code=status.HTTP_202_ACCEPTED,
)
async def publish_facebook_delivery_now(
    delivery_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    row = await db.execute(
        select(FacebookProject.owner_id)
        .join(FacebookContent, FacebookContent.project_id == FacebookProject.id)
        .join(FacebookDelivery, FacebookDelivery.content_id == FacebookContent.id)
        .where(FacebookDelivery.id == delivery_id)
    )
    owner_id = row.scalar_one_or_none()
    if owner_id is None:
        raise HTTPException(status_code=404, detail="Facebook delivery not found")
    if owner_id != user.id:
        raise HTTPException(status_code=403, detail="Not the owner of this Facebook project")
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
        raise HTTPException(
            status_code=409,
            detail="This Facebook publication is already running or completed.",
        )
    await db.commit()
    background_tasks.add_task(
        publish_facebook_delivery,
        delivery_id,
        already_claimed=True,
    )
    return {"ok": True, "status": "publishing"}
