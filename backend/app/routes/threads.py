from __future__ import annotations

import json
import logging
import time
import uuid
import uuid as _uuid_module
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

logger = logging.getLogger(__name__)
from pydantic import BaseModel
from sqlalchemy import select, delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..crypto import decrypt, encrypt
from ..database import get_db
from ..db_models import (
    ThreadsAccount,
    ThreadsPost,
    ThreadsPostStatus,
    ThreadsProject,
    User,
)
from ..dependencies import get_current_user
from ..services import threads_api

router = APIRouter(tags=["threads"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class ThreadsProjectCreate(BaseModel):
    name: str
    description: str = ""
    app_id: str
    app_secret: str


class ThreadsProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    app_id: str | None = None
    app_secret: str | None = None


class ThreadsProjectOut(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    description: str
    app_id: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class ThreadsAccountOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    threads_user_id: str
    username: str
    token_expires_at: datetime | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class ThreadsOAuthCallbackBody(BaseModel):
    code: str
    state: str  # project_id


class ThreadsPostCreate(BaseModel):
    account_id: uuid.UUID
    text_content: str
    image_url: str | None = None
    media_urls: list[str] | None = None
    first_comment: str | None = None
    scheduled_at: datetime | None = None


class ThreadsPostUpdate(BaseModel):
    account_id: uuid.UUID | None = None
    text_content: str | None = None
    image_url: str | None = None
    media_urls: list[str] | None = None
    first_comment: str | None = None
    scheduled_at: datetime | None = None


class ThreadsPostOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    account_id: uuid.UUID
    text_content: str
    image_url: str | None = None
    media_urls: list[str] | None = None
    first_comment: str | None = None
    status: str
    scheduled_at: datetime | None = None
    published_at: datetime | None = None
    threads_post_id: str | None = None
    error_message: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True

    @classmethod
    def from_db(cls, post: "ThreadsPost") -> "ThreadsPostOut":
        try:
            media = json.loads(post.media_urls) if post.media_urls else None
        except Exception:
            media = None
        return cls(
            id=post.id,
            project_id=post.project_id,
            account_id=post.account_id,
            text_content=post.text_content,
            image_url=post.image_url,
            media_urls=media,
            first_comment=post.first_comment,
            status=post.status,
            scheduled_at=post.scheduled_at,
            published_at=post.published_at,
            threads_post_id=post.threads_post_id,
            error_message=post.error_message,
            created_at=post.created_at,
        )


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_threads_project(
    project_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> ThreadsProject:
    """Fetch a ThreadsProject and verify the current user is its owner."""
    row = await db.execute(
        select(ThreadsProject).where(ThreadsProject.id == project_id)
    )
    project = row.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Threads project not found")
    if project.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Not the owner of this Threads project")
    return project


async def _get_threads_post(
    post_id: uuid.UUID,
    user: User,
    db: AsyncSession,
) -> ThreadsPost:
    """Fetch a ThreadsPost and verify ownership via its project."""
    row = await db.execute(
        select(ThreadsPost).where(ThreadsPost.id == post_id)
    )
    post = row.scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Threads post not found")
    # Verify project ownership
    await _get_threads_project(post.project_id, user, db)
    return post


# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("/api/threads-projects", response_model=list[ThreadsProjectOut])
async def list_threads_projects(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    rows = await db.execute(
        select(ThreadsProject)
        .where(ThreadsProject.owner_id == user.id)
        .order_by(ThreadsProject.created_at.desc())
    )
    return rows.scalars().all()


@router.post(
    "/api/threads-projects",
    response_model=ThreadsProjectOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_threads_project(
    body: ThreadsProjectCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = ThreadsProject(
        owner_id=user.id,
        name=body.name,
        description=body.description,
        app_id=body.app_id.strip(),
        app_secret=encrypt(body.app_secret.strip()),
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.patch("/api/threads-projects/{project_id}", response_model=ThreadsProjectOut)
async def update_threads_project(
    project_id: uuid.UUID,
    body: ThreadsProjectUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = await _get_threads_project(project_id, user, db)
    if body.name is not None:
        project.name = body.name
    if body.description is not None:
        project.description = body.description
    if body.app_id is not None:
        project.app_id = body.app_id.strip()
    if body.app_secret is not None:
        project.app_secret = encrypt(body.app_secret.strip())
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/api/threads-projects/{project_id}", response_model=ThreadsProjectOut)
async def get_threads_project(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await _get_threads_project(project_id, user, db)


@router.delete(
    "/api/threads-projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_threads_project(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _get_threads_project(project_id, user, db)
    await db.execute(
        sql_delete(ThreadsProject).where(ThreadsProject.id == project_id)
    )
    await db.commit()


# ── Accounts ──────────────────────────────────────────────────────────────────

@router.get(
    "/api/threads-projects/{project_id}/accounts",
    response_model=list[ThreadsAccountOut],
)
async def list_threads_accounts(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _get_threads_project(project_id, user, db)
    rows = await db.execute(
        select(ThreadsAccount)
        .where(ThreadsAccount.project_id == project_id)
        .order_by(ThreadsAccount.created_at.asc())
    )
    return rows.scalars().all()


@router.delete(
    "/api/threads-projects/{project_id}/accounts/{acc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_threads_account(
    project_id: uuid.UUID,
    acc_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _get_threads_project(project_id, user, db)
    row = await db.execute(
        select(ThreadsAccount).where(
            ThreadsAccount.id == acc_id,
            ThreadsAccount.project_id == project_id,
        )
    )
    account = row.scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Threads account not found")
    await db.execute(
        sql_delete(ThreadsAccount).where(ThreadsAccount.id == acc_id)
    )
    await db.commit()


# ── Manual token add ──────────────────────────────────────────────────────────

class ThreadsAccountTokenAdd(BaseModel):
    access_token: str


@router.post(
    "/api/threads-projects/{project_id}/accounts/token",
    response_model=ThreadsAccountOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_threads_account_by_token(
    project_id: uuid.UUID,
    body: ThreadsAccountTokenAdd,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Add a Threads account by pasting a long-lived access token directly.
    Validates the token against the Threads API, then stores the account.
    """
    await _get_threads_project(project_id, user, db)

    token = body.access_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="access_token is required")

    try:
        user_info = threads_api.get_user_info_by_token(token)
    except ValueError as exc:
        logger.warning("Threads token validation failed for project %s: %s", project_id, str(exc)[:500])
        raise HTTPException(status_code=400, detail="Invalid Threads access token")

    threads_user_id = str(user_info["id"])
    username = user_info.get("username", threads_user_id)

    # Long-lived tokens are valid for ~60 days; set expiry accordingly
    token_expires_at = datetime.now(timezone.utc) + timedelta(days=60)

    # Upsert: update if account already exists in this project
    existing_row = await db.execute(
        select(ThreadsAccount).where(
            ThreadsAccount.project_id == project_id,
            ThreadsAccount.threads_user_id == threads_user_id,
        )
    )
    account = existing_row.scalar_one_or_none()

    if account:
        account.access_token = encrypt(token)
        account.username = username
        account.token_expires_at = token_expires_at
    else:
        account = ThreadsAccount(
            project_id=project_id,
            threads_user_id=threads_user_id,
            username=username,
            access_token=encrypt(token),
            token_expires_at=token_expires_at,
        )
        db.add(account)

    await db.commit()
    await db.refresh(account)
    return account


# ── OAuth ─────────────────────────────────────────────────────────────────────

class OAuthUrlOut(BaseModel):
    url: str


@router.get("/api/threads/oauth/url", response_model=OAuthUrlOut)
async def threads_oauth_url(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    project = await _get_threads_project(project_id, user, db)
    if not project.app_id or not project.app_secret:
        raise HTTPException(
            status_code=400,
            detail="This project has no Threads app credentials. Edit the project to add App ID and App Secret.",
        )
    url = threads_api.get_oauth_url(
        app_id=project.app_id,
        redirect_uri=settings.threads_redirect_uri,
        state=str(project_id),
    )
    return OAuthUrlOut(url=url)


@router.post(
    "/api/threads/oauth/callback",
    response_model=ThreadsAccountOut,
    status_code=status.HTTP_201_CREATED,
)
async def threads_oauth_callback(
    body: ThreadsOAuthCallbackBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    # state is the project_id
    try:
        project_id = uuid.UUID(body.state)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid state parameter (must be a project UUID)")

    project = await _get_threads_project(project_id, user, db)
    if not project.app_id or not project.app_secret:
        raise HTTPException(status_code=400, detail="Project has no Threads app credentials configured.")

    try:
        app_secret = decrypt(project.app_secret)
        token_data = threads_api.exchange_code_for_token(
            code=body.code,
            app_id=project.app_id,
            app_secret=app_secret,
            redirect_uri=settings.threads_redirect_uri,
        )
    except ValueError as exc:
        logger.warning("Threads OAuth code exchange failed for project %s: %s", project_id, str(exc)[:500])
        raise HTTPException(status_code=400, detail="Threads OAuth code exchange failed")

    access_token = token_data["access_token"]
    threads_user_id = token_data["user_id"]
    expires_in = token_data.get("expires_in", 5183944)

    try:
        user_info = threads_api.get_user_info(access_token, threads_user_id)
    except ValueError as exc:
        logger.warning("Threads user info lookup failed for project %s: %s", project_id, str(exc)[:500])
        raise HTTPException(status_code=400, detail="Failed to fetch Threads account information")

    username = user_info.get("username", threads_user_id)
    token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))

    # Upsert: if an account with same threads_user_id already exists in this project, update it
    existing_row = await db.execute(
        select(ThreadsAccount).where(
            ThreadsAccount.project_id == project_id,
            ThreadsAccount.threads_user_id == threads_user_id,
        )
    )
    account = existing_row.scalar_one_or_none()

    if account:
        account.access_token = encrypt(access_token)
        account.username = username
        account.token_expires_at = token_expires_at
    else:
        account = ThreadsAccount(
            project_id=project_id,
            threads_user_id=threads_user_id,
            username=username,
            access_token=encrypt(access_token),
            token_expires_at=token_expires_at,
        )
        db.add(account)

    await db.commit()
    await db.refresh(account)
    return account


# ── Media Upload ─────────────────────────────────────────────────────────────

_ALLOWED_IMAGE_MIME = {"image/jpeg", "image/png", "image/gif", "image/webp"}
_ALLOWED_VIDEO_MIME = {"video/mp4", "video/quicktime"}
_ALLOWED_MIME = _ALLOWED_IMAGE_MIME | _ALLOWED_VIDEO_MIME

# Threads API limits
_MAX_IMAGE_SIZE = 8 * 1024 * 1024    # 8 MB
_MAX_VIDEO_SIZE = 1 * 1024 * 1024 * 1024  # 1 GB
_MIN_IMAGE_DIM = 320  # px


@router.post("/api/threads/upload-media")
async def upload_threads_media(
    files: List[UploadFile] = File(...),
    user: User = Depends(get_current_user),
):
    import io
    import cloudinary
    import cloudinary.uploader
    from PIL import Image

    if not settings.cloudinary_cloud_name:
        raise HTTPException(status_code=503, detail="Cloudinary is not configured")

    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
    )

    urls: list[str] = []
    for f in files:
        name = f.filename or "file"
        mime = f.content_type or ""

        if mime not in _ALLOWED_MIME:
            raise HTTPException(
                status_code=400,
                detail=f"{name}: unsupported type '{mime}'. Allowed: JPEG, PNG, GIF, WebP, MP4, MOV."
            )

        data = await f.read()
        is_video = mime in _ALLOWED_VIDEO_MIME

        if is_video:
            if len(data) > _MAX_VIDEO_SIZE:
                raise HTTPException(status_code=400, detail=f"{name}: video exceeds 1 GB limit.")
        else:
            if len(data) > _MAX_IMAGE_SIZE:
                raise HTTPException(status_code=400, detail=f"{name}: image exceeds 8 MB limit.")
            # Check minimum dimensions
            try:
                img = Image.open(io.BytesIO(data))
                w, h = img.size
                if w < _MIN_IMAGE_DIM or h < _MIN_IMAGE_DIM:
                    raise HTTPException(
                        status_code=400,
                        detail=f"{name}: image too small ({w}×{h}px). Minimum is 320×320px."
                    )
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=400, detail=f"{name}: could not read image file.")

        resource_type = "video" if is_video else "image"
        result = cloudinary.uploader.upload(
            data,
            folder="threads",
            resource_type=resource_type,
            public_id=_uuid_module.uuid4().hex,
        )
        urls.append(result["secure_url"])
    return {"urls": urls}


# ── Posts ─────────────────────────────────────────────────────────────────────

@router.get(
    "/api/threads-projects/{project_id}/posts",
    response_model=list[ThreadsPostOut],
)
async def list_threads_posts(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _get_threads_project(project_id, user, db)
    rows = await db.execute(
        select(ThreadsPost)
        .where(ThreadsPost.project_id == project_id)
        .order_by(ThreadsPost.created_at.desc())
    )
    return [ThreadsPostOut.from_db(p) for p in rows.scalars().all()]


@router.post(
    "/api/threads-projects/{project_id}/posts",
    response_model=ThreadsPostOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_threads_post(
    project_id: uuid.UUID,
    body: ThreadsPostCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _get_threads_project(project_id, user, db)

    # Verify the account belongs to this project
    acc_row = await db.execute(
        select(ThreadsAccount).where(
            ThreadsAccount.id == body.account_id,
            ThreadsAccount.project_id == project_id,
        )
    )
    if acc_row.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Threads account not found in this project")

    post_status = (
        ThreadsPostStatus.scheduled if body.scheduled_at else ThreadsPostStatus.draft
    )

    post = ThreadsPost(
        project_id=project_id,
        account_id=body.account_id,
        text_content=body.text_content,
        image_url=body.image_url,
        media_urls=json.dumps(body.media_urls) if body.media_urls else None,
        first_comment=body.first_comment,
        scheduled_at=body.scheduled_at,
        status=post_status,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return ThreadsPostOut.from_db(post)


@router.post("/api/threads-posts/{post_id}/publish", response_model=ThreadsPostOut)
async def publish_threads_post_now(
    post_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Publish a post immediately, regardless of its current status."""
    post = await _get_threads_post(post_id, user, db)

    acc_row = await db.execute(
        select(ThreadsAccount).where(ThreadsAccount.id == post.account_id)
    )
    account = acc_row.scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Linked Threads account not found")

    try:
        access_token = decrypt(account.access_token)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt access token")

    def _to_absolute(url: str) -> str:
        """Always resolve to an absolute publicly accessible URL."""
        if not url:
            return url
        if "/uploads/" in url:
            suffix = url.split("/uploads/", 1)[1]
            return settings.server_base_url.rstrip("/") + "/uploads/" + suffix
        if url.startswith("/"):
            return settings.server_base_url.rstrip("/") + url
        return url

    try:
        media = json.loads(post.media_urls) if post.media_urls else None
        abs_media = [_to_absolute(u) for u in media] if media else None
        abs_image = _to_absolute(post.image_url) if post.image_url else None
        threads_post_id = threads_api.publish_post(
            access_token=access_token,
            user_id=account.threads_user_id,
            text=post.text_content,
            media_urls=abs_media,
            image_url=abs_image,
        )
    except ValueError as exc:
        logger.error("[threads] publish failed for post %s: %s", post.id, str(exc)[:500])
        post.status = ThreadsPostStatus.failed
        post.error_message = "Failed to publish to Threads"
        await db.commit()
        await db.refresh(post)
        raise HTTPException(status_code=400, detail="Failed to publish to Threads")

    # Optionally post first comment as a reply
    if post.first_comment:
        time.sleep(3)
        try:
            threads_api.add_reply(
                access_token=access_token,
                user_id=account.threads_user_id,
                post_id=threads_post_id,
                text=post.first_comment,
            )
        except Exception as reply_exc:
            print(f"[threads] reply failed for post {post.id}: {reply_exc}")

    post.status = ThreadsPostStatus.published
    post.published_at = datetime.now(timezone.utc)
    post.threads_post_id = threads_post_id
    post.error_message = None
    await db.commit()
    await db.refresh(post)

    # Delete Cloudinary media now that the post is published
    if settings.cloudinary_cloud_name:
        from ..services.cloudinary_utils import delete_cloudinary_media
        all_media = list(filter(None, (abs_media or []) + ([abs_image] if abs_image else [])))
        delete_cloudinary_media(all_media, settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret)

    return ThreadsPostOut.from_db(post)


class BatchPublishBody(BaseModel):
    post_ids: list[uuid.UUID]


class BatchPublishResult(BaseModel):
    succeeded: list[str]
    failed: list[dict]


@router.post("/api/threads-posts/batch-publish", response_model=BatchPublishResult)
async def batch_publish_threads_posts(
    body: BatchPublishBody,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Publish multiple posts sequentially."""
    succeeded: list[str] = []
    failed: list[dict] = []

    for post_id in body.post_ids:
        try:
            post = await _get_threads_post(post_id, user, db)
        except HTTPException:
            failed.append({"id": str(post_id), "error": "Post not found"})
            continue

        acc_row = await db.execute(
            select(ThreadsAccount).where(ThreadsAccount.id == post.account_id)
        )
        account = acc_row.scalar_one_or_none()
        if not account:
            failed.append({"id": str(post_id), "error": "Account not found"})
            continue

        try:
            access_token = decrypt(account.access_token)
        except Exception:
            failed.append({"id": str(post_id), "error": "Could not decrypt token"})
            continue

        try:
            batch_media = json.loads(post.media_urls) if post.media_urls else None
            _base = settings.server_base_url.rstrip("/")
            def _abs(u: str) -> str:
                if not u: return u
                if "/uploads/" in u:
                    return _base + "/uploads/" + u.split("/uploads/", 1)[1]
                return u if u.startswith("http") else _base + u
            abs_batch = [_abs(u) for u in batch_media] if batch_media else None
            abs_img = _abs(post.image_url) if post.image_url else None
            threads_post_id = threads_api.publish_post(
                access_token=access_token,
                user_id=account.threads_user_id,
                text=post.text_content,
                media_urls=abs_batch,
                image_url=abs_img,
            )
        except ValueError as exc:
            logger.error("[threads] batch publish failed for post %s: %s", post.id, str(exc)[:500])
            post.status = ThreadsPostStatus.failed
            post.error_message = "Failed to publish to Threads"
            await db.commit()
            failed.append({"id": str(post_id), "error": "Failed to publish to Threads"})
            continue

        if post.first_comment:
            time.sleep(3)
            try:
                threads_api.add_reply(
                    access_token=access_token,
                    user_id=account.threads_user_id,
                    post_id=threads_post_id,
                    text=post.first_comment,
                )
            except Exception as reply_exc:
                print(f"[threads] batch reply failed for post {post.id}: {reply_exc}")

        post.status = ThreadsPostStatus.published
        post.published_at = datetime.now(timezone.utc)
        post.threads_post_id = threads_post_id
        post.error_message = None
        await db.commit()

        # Delete Cloudinary media now that the post is published
        if settings.cloudinary_cloud_name:
            from ..services.cloudinary_utils import delete_cloudinary_media
            all_media = list(filter(None, (abs_batch or []) + ([abs_img] if abs_img else [])))
            delete_cloudinary_media(all_media, settings.cloudinary_cloud_name, settings.cloudinary_api_key, settings.cloudinary_api_secret)

        succeeded.append(str(post_id))

    return BatchPublishResult(succeeded=succeeded, failed=failed)


@router.delete(
    "/api/threads-posts/{post_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_threads_post(
    post_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await _get_threads_post(post_id, user, db)
    await db.execute(sql_delete(ThreadsPost).where(ThreadsPost.id == post_id))
    await db.commit()


@router.patch("/api/threads-posts/{post_id}", response_model=ThreadsPostOut)
async def update_threads_post(
    post_id: uuid.UUID,
    body: ThreadsPostUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    post = await _get_threads_post(post_id, user, db)

    if body.account_id is not None:
        # Verify account belongs to the same project
        acc_row = await db.execute(
            select(ThreadsAccount).where(
                ThreadsAccount.id == body.account_id,
                ThreadsAccount.project_id == post.project_id,
            )
        )
        if acc_row.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=404, detail="Threads account not found in this project"
            )
        post.account_id = body.account_id

    if body.text_content is not None:
        post.text_content = body.text_content
    if body.image_url is not None:
        post.image_url = body.image_url
    if body.media_urls is not None:
        post.media_urls = json.dumps(body.media_urls) if body.media_urls else None
    if body.first_comment is not None:
        post.first_comment = body.first_comment
    if body.scheduled_at is not None:
        post.scheduled_at = body.scheduled_at
        # Auto-promote to scheduled if the post is still a draft or failed
        if post.status in (ThreadsPostStatus.draft, ThreadsPostStatus.failed):
            post.status = ThreadsPostStatus.scheduled

    await db.commit()
    await db.refresh(post)
    return ThreadsPostOut.from_db(post)
