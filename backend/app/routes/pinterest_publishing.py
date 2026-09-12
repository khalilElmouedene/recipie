from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..db_models import Site, User
from ..dependencies import check_project_access, get_current_user
from ..pinterest_models import PinterestOAuthState, PinterestPublication, PinterestPublisher
from ..services import pinterest_api as api
from ..services import pinterest_publisher as service

router = APIRouter(prefix="/api", tags=["pinterest-publishing"])


def publishing_user(user: User = Depends(get_current_user)) -> User:
    if user.email.strip().casefold() != service.ALLOWED_EMAIL:
        raise HTTPException(403, "Pinterest automatic publishing is not available for this account")
    return user


async def authorized_site(site_id: uuid.UUID, user: User, db: AsyncSession) -> Site:
    # Keep the check here as well so direct/internal calls cannot bypass it.
    publishing_user(user)
    site = await db.get(Site, site_id)
    if not site:
        raise HTTPException(404, "Website not found")
    await check_project_access(site.project_id, user, db)
    return site


async def ensure_publisher(db: AsyncSession, site_id: uuid.UUID, user_id: uuid.UUID) -> PinterestPublisher:
    await db.execute(insert(PinterestPublisher).values(site_id=site_id, user_id=user_id).on_conflict_do_nothing())
    await db.commit()
    return await db.get(PinterestPublisher, site_id)


class PublishingSettings(BaseModel):
    daily_limit: int = Field(ge=1, le=1000, strict=True)
    interval_minutes: int = Field(ge=1, le=10080, strict=True)
    enabled: bool


class CallbackBody(BaseModel):
    site_id: uuid.UUID
    code: str = Field(min_length=1, max_length=4096)
    state: str = Field(min_length=20, max_length=200)


class PublicationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    recipe_id: uuid.UUID
    title: str
    description: str
    board_name: str
    keywords: str
    article_url: str
    image_url: str
    status: str
    pin_id: str | None
    published_at: datetime | None
    attempted_at: datetime | None
    attempt_count: int
    retry_safe: bool
    next_retry_at: datetime | None
    error: str | None


async def publisher_status(db: AsyncSession, publisher: PinterestPublisher, site: Site) -> dict:
    now = service.utcnow()
    usage = await service.daily_usage(db, site.id, now)
    counts = dict((await db.execute(select(PinterestPublication.status, func.count()).where(
        PinterestPublication.site_id == site.id).group_by(PinterestPublication.status))).all())
    # Explicit allowlist: ORM credential fields are never serialized.
    return dict(site_id=str(site.id), project_id=str(site.project_id), domain=site.domain,
        connected=bool(publisher.access_token_encrypted), username=publisher.username,
        configured=bool(settings.pinterest_client_id and settings.pinterest_client_secret),
        enabled=publisher.enabled, daily_limit=publisher.daily_limit, interval_minutes=publisher.interval_minutes,
        timezone="UTC", daily_usage=usage, counts={s: counts.get(s, 0) for s in ("pending", "publishing", "published", "failed")},
        next_publication_at=service.next_publication_at(publisher, usage, now) if publisher.enabled else None,
        last_error=publisher.last_error)


@router.get("/sites/{site_id}/pinterest-publishing")
async def get_publisher(site_id: uuid.UUID, user: User = Depends(publishing_user), db: AsyncSession = Depends(get_db)):
    site = await authorized_site(site_id, user, db)
    publisher = await ensure_publisher(db, site_id, user.id)
    return await publisher_status(db, publisher, site)


@router.get("/sites/{site_id}/pinterest-publishing/items")
async def get_items(site_id: uuid.UUID, user: User = Depends(publishing_user), db: AsyncSession = Depends(get_db),
    status: str | None = Query(None, pattern="^(pending|publishing|published|failed)$"),
    offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
    await authorized_site(site_id, user, db)
    conditions = [PinterestPublication.site_id == site_id]
    if status:
        conditions.append(PinterestPublication.status == status)
    total = await db.scalar(select(func.count()).select_from(PinterestPublication).where(*conditions))
    items = (await db.scalars(select(PinterestPublication).where(*conditions).order_by(
        PinterestPublication.created_at.desc(), PinterestPublication.id).offset(offset).limit(limit))).all()
    return {"total": total, "items": [PublicationOut.model_validate(item) for item in items]}


@router.post("/sites/{site_id}/pinterest-publishing/sync")
async def sync_items(site_id: uuid.UUID, user: User = Depends(publishing_user), db: AsyncSession = Depends(get_db)):
    await authorized_site(site_id, user, db)
    await ensure_publisher(db, site_id, user.id)
    await service.sync_queue(db, site_id)
    return {"ok": True}


@router.put("/sites/{site_id}/pinterest-publishing/settings")
async def save_settings(site_id: uuid.UUID, body: PublishingSettings,
    user: User = Depends(publishing_user), db: AsyncSession = Depends(get_db)):
    site = await authorized_site(site_id, user, db)
    await ensure_publisher(db, site_id, user.id)
    publisher = await db.scalar(select(PinterestPublisher).where(PinterestPublisher.site_id == site_id)
        .with_for_update().execution_options(populate_existing=True))
    if body.enabled and not publisher.access_token_encrypted:
        raise HTTPException(400, "Connect Pinterest before starting automatic publishing")
    publisher.daily_limit = body.daily_limit
    publisher.interval_minutes = body.interval_minutes
    publisher.enabled = body.enabled
    publisher.user_id = user.id
    await db.commit()
    return await publisher_status(db, publisher, site)


@router.post("/sites/{site_id}/pinterest-publishing/auth-url")
async def auth_url(site_id: uuid.UUID, user: User = Depends(publishing_user), db: AsyncSession = Depends(get_db)):
    await authorized_site(site_id, user, db)
    if not settings.pinterest_client_id or not settings.pinterest_client_secret:
        raise HTTPException(400, "Pinterest OAuth is not configured on the server")
    state = secrets.token_urlsafe(32)
    await db.execute(delete(PinterestOAuthState).where(PinterestOAuthState.expires_at < service.utcnow()))
    db.add(PinterestOAuthState(token_hash=hashlib.sha256(state.encode()).hexdigest(), site_id=site_id,
        user_id=user.id, expires_at=service.utcnow() + timedelta(minutes=10)))
    await db.commit()
    url = "https://www.pinterest.com/oauth/?" + urlencode(dict(client_id=settings.pinterest_client_id,
        redirect_uri=settings.pinterest_redirect_uri, response_type="code", scope=api.SCOPES, state=state))
    return {"url": url, "state": state}


@router.post("/pinterest-publishing/callback")
async def callback(body: CallbackBody, user: User = Depends(publishing_user), db: AsyncSession = Depends(get_db)):
    site = await authorized_site(body.site_id, user, db)
    async with service.site_lock(site.id) as locked:
        if locked is None:
            raise HTTPException(409, "A pin is being processed. Wait a moment and reconnect.")
        consumed = await locked.scalar(delete(PinterestOAuthState).where(
            PinterestOAuthState.token_hash == hashlib.sha256(body.state.encode()).hexdigest(),
            PinterestOAuthState.site_id == site.id, PinterestOAuthState.user_id == user.id,
            PinterestOAuthState.expires_at > service.utcnow()).returning(PinterestOAuthState.token_hash)
            .execution_options(synchronize_session=False))
        await locked.commit()
        if not consumed:
            raise HTTPException(400, "Invalid, expired or already used OAuth state. Connect Pinterest again.")
        try:
            tokens = await api.exchange_token(grant_type="authorization_code", code=body.code,
                redirect_uri=settings.pinterest_redirect_uri, continuous_refresh="true")
            granted = set(tokens.get("scope", "").replace(",", " ").split())
            if not set(api.SCOPES.split(",")).issubset(granted) or not tokens.get("refresh_token"):
                raise api.PinterestError("Pinterest did not grant the permissions needed for automatic publishing.")
            account = await api.request("GET", "/user_account", tokens["access_token"])
            if not account.get("username"):
                raise api.PinterestError("Pinterest account identity could not be verified.")
            publisher = await ensure_publisher(locked, site.id, user.id)
            publisher.enabled = False
            publisher.user_id = user.id
            publisher.username = account["username"]
            publisher.refresh_expires_at = None
            await service.store_tokens(publisher, tokens)
            publisher.last_error = None
            await locked.commit()
            await service.sync_queue(locked, site.id)
            return await publisher_status(locked, publisher, site)
        except api.PinterestError as error:
            raise HTTPException(400, str(error)) from None


@router.delete("/sites/{site_id}/pinterest-publishing/connection")
async def disconnect(site_id: uuid.UUID, user: User = Depends(publishing_user), db: AsyncSession = Depends(get_db)):
    await authorized_site(site_id, user, db)
    async with service.site_lock(site_id) as locked:
        if locked is None:
            raise HTTPException(409, "A pin is being processed. Stop publishing, then disconnect after it finishes.")
        publisher = await locked.get(PinterestPublisher, site_id)
        if publisher:
            publisher.enabled = False
            publisher.access_token_encrypted = None
            publisher.refresh_token_encrypted = None
            publisher.token_expires_at = None
            publisher.refresh_expires_at = None
            publisher.username = None
        await locked.execute(delete(PinterestOAuthState).where(PinterestOAuthState.site_id == site_id))
        await locked.commit()
    return {"ok": True}


class RetryBody(BaseModel):
    confirmed_not_published: bool = False


@router.post("/sites/{site_id}/pinterest-publishing/items/{item_id}/retry")
async def retry_item(site_id: uuid.UUID, item_id: uuid.UUID, body: RetryBody,
    user: User = Depends(publishing_user), db: AsyncSession = Depends(get_db)):
    await authorized_site(site_id, user, db)
    item = await db.scalar(select(PinterestPublication).where(PinterestPublication.site_id == site_id,
        PinterestPublication.id == item_id).with_for_update())
    if not item:
        raise HTTPException(404, "Publishing item not found")
    if item.status != "failed" or item.pin_id:
        raise HTTPException(409, "Only failed items without a saved Pin ID can be retried")
    if not item.retry_safe and not body.confirmed_not_published:
        raise HTTPException(409, "Check Pinterest first: this pin may already exist")
    item.status = "pending"
    item.retry_safe = True
    item.dispatched_at = None
    item.next_retry_at = None
    item.attempt_count = 0
    await db.commit()
    return {"ok": True}


class ReconcileBody(BaseModel):
    pin_id: str = Field(pattern=r"^\d{1,100}$")


@router.post("/sites/{site_id}/pinterest-publishing/items/{item_id}/reconcile")
async def reconcile_item(site_id: uuid.UUID, item_id: uuid.UUID, body: ReconcileBody,
    user: User = Depends(publishing_user), db: AsyncSession = Depends(get_db)):
    await authorized_site(site_id, user, db)
    async with service.site_lock(site_id) as locked:
        if locked is None:
            raise HTTPException(409, "Publishing is busy. Try again shortly.")
        item = await locked.scalar(select(PinterestPublication).where(PinterestPublication.site_id == site_id,
            PinterestPublication.id == item_id).with_for_update())
        if not item or item.status != "failed" or item.retry_safe or item.pin_id:
            raise HTTPException(409, "This item does not need reconciliation")
        publisher = await locked.get(PinterestPublisher, site_id)
        if not publisher:
            raise HTTPException(400, "Connect Pinterest first")
        try:
            token = await service.access_token(locked, publisher)
            pin = await api.request("GET", f"/pins/{body.pin_id}", token)
            if str(pin.get("board_id")) != item.board_id or pin.get("link") != item.article_url or pin.get("title") != item.title.strip()[:100]:
                raise HTTPException(400, "This Pinterest pin does not match the item's board, title and article URL")
            duplicate = await locked.scalar(select(PinterestPublication.id).where(PinterestPublication.pin_id == body.pin_id))
            if duplicate:
                raise HTTPException(409, "This Pin ID is already recorded")
            item.pin_id = body.pin_id
            item.status = "published"
            item.published_at = service.aware(datetime.fromisoformat(pin["created_at"].replace("Z", "+00:00"))) if pin.get("created_at") else service.utcnow()
            item.error = None
            item.next_retry_at = None
            await locked.commit()
            return {"ok": True}
        except api.PinterestError as error:
            raise HTTPException(400, str(error)) from None
