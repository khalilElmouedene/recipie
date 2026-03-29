from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

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


class ThreadsProjectOut(BaseModel):
    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    description: str
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
    first_comment: str | None = None
    scheduled_at: datetime | None = None


class ThreadsPostUpdate(BaseModel):
    account_id: uuid.UUID | None = None
    text_content: str | None = None
    image_url: str | None = None
    first_comment: str | None = None
    scheduled_at: datetime | None = None


class ThreadsPostOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    account_id: uuid.UUID
    text_content: str
    image_url: str | None = None
    first_comment: str | None = None
    status: str
    scheduled_at: datetime | None = None
    published_at: datetime | None = None
    threads_post_id: str | None = None
    error_message: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


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
    )
    db.add(project)
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


# ── OAuth ─────────────────────────────────────────────────────────────────────

class OAuthUrlOut(BaseModel):
    url: str


@router.get("/api/threads/oauth/url", response_model=OAuthUrlOut)
async def threads_oauth_url(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    app_id_preview = (settings.threads_app_id or "")[:6] or "(empty)"
    logger.info("threads_oauth_url: app_id=%s... redirect_uri=%s", app_id_preview, settings.threads_redirect_uri)
    if not settings.threads_app_id or not settings.threads_app_secret:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Threads OAuth is not configured. "
                f"THREADS_APP_ID={'set' if settings.threads_app_id else 'MISSING'}, "
                f"THREADS_APP_SECRET={'set' if settings.threads_app_secret else 'MISSING'}. "
                f"Set these in your .env and restart the backend."
            ),
        )
    # Verify project ownership before generating OAuth URL
    await _get_threads_project(project_id, user, db)
    url = threads_api.get_oauth_url(state=str(project_id))
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

    await _get_threads_project(project_id, user, db)

    try:
        token_data = threads_api.exchange_code_for_token(body.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    access_token = token_data["access_token"]
    threads_user_id = token_data["user_id"]
    expires_in = token_data.get("expires_in", 5183944)

    try:
        user_info = threads_api.get_user_info(access_token, threads_user_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

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
    return rows.scalars().all()


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
        first_comment=body.first_comment,
        scheduled_at=body.scheduled_at,
        status=post_status,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return post


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

    try:
        threads_post_id = threads_api.publish_post(
            access_token=access_token,
            user_id=account.threads_user_id,
            text=post.text_content,
            image_url=post.image_url,
        )
    except ValueError as exc:
        post.status = ThreadsPostStatus.failed
        post.error_message = str(exc)
        await db.commit()
        await db.refresh(post)
        raise HTTPException(status_code=502, detail=str(exc))

    # Optionally post first comment as a reply
    if post.first_comment:
        try:
            threads_api.add_reply(
                access_token=access_token,
                user_id=account.threads_user_id,
                post_id=threads_post_id,
                text=post.first_comment,
            )
        except Exception as reply_exc:
            # Non-fatal: log but don't fail the whole request
            print(f"[threads] reply failed for post {post.id}: {reply_exc}")

    post.status = ThreadsPostStatus.published
    post.published_at = datetime.now(timezone.utc)
    post.threads_post_id = threads_post_id
    post.error_message = None
    await db.commit()
    await db.refresh(post)
    return post


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
    if body.first_comment is not None:
        post.first_comment = body.first_comment
    if body.scheduled_at is not None:
        post.scheduled_at = body.scheduled_at
        # Auto-promote to scheduled if the post is still a draft or failed
        if post.status in (ThreadsPostStatus.draft, ThreadsPostStatus.failed):
            post.status = ThreadsPostStatus.scheduled

    await db.commit()
    await db.refresh(post)
    return post
