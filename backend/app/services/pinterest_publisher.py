from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, exists, func, or_, select, text, update
from cryptography.fernet import InvalidToken
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..crypto import decrypt, encrypt
from ..config import settings
from ..database import SessionLocal, engine
from ..db_models import Project, ProjectMember, Recipe, RecipeStatus, Site, User
from ..pinterest_models import PinterestPublication, PinterestPublisher, PinterestPublishingLog
from . import pinterest_api as api

logger = logging.getLogger(__name__)
ALLOWED_EMAIL = "khalil@gmail.com"
MAX_AUTO_ATTEMPTS = 5


def utcnow():
    return datetime.now(timezone.utc)


def aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


@asynccontextmanager
async def locked_session(key: str):
    """A dedicated connection keeps the advisory lock across durable commits.

    Every process uses this lock, so multiple API workers cannot dispatch a site
    twice. Connection loss releases the lock; the committed dispatch marker then
    prevents the replacement worker from resending an uncertain request.
    """
    lock_id = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True)
    async with engine.connect() as connection:
        acquired = await connection.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": lock_id})
        await connection.commit()
        if not acquired:
            yield None
            return
        try:
            async with AsyncSession(bind=connection, expire_on_commit=False) as db:
                yield db
        finally:
            try:
                await connection.rollback()
                await connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": lock_id})
                await connection.commit()
            except BaseException:
                await connection.invalidate()
                raise


def site_lock(site_id: uuid.UUID):
    return locked_session(f"pinterest-site:{site_id}")


def app_credentials(publisher: PinterestPublisher) -> tuple[str, str]:
    """Return an entire website credential pair, or the server defaults."""
    if publisher.client_id:
        if not publisher.app_secret_encrypted:
            raise api.PinterestError("Save the Pinterest App Secret for this website first.", reconnect=True)
        try:
            return publisher.client_id, decrypt(publisher.app_secret_encrypted)
        except InvalidToken:
            raise api.PinterestError("The saved Pinterest App Secret could not be read. Replace it in app settings.", reconnect=True) from None
    return settings.pinterest_client_id, settings.pinterest_client_secret


def credential_status(publisher: PinterestPublisher) -> dict:
    custom = bool(publisher.client_id)
    client_id = publisher.client_id if custom else settings.pinterest_client_id
    has_secret = bool(publisher.app_secret_encrypted if custom else settings.pinterest_client_secret)
    return dict(client_id=client_id or "", has_app_secret=has_secret,
        credential_source="website" if custom else "server", configured=bool(client_id and has_secret),
        redirect_uri=settings.pinterest_redirect_uri)


def clear_connection(publisher: PinterestPublisher):
    publisher.enabled = False
    publisher.access_token_encrypted = None
    publisher.refresh_token_encrypted = None
    publisher.token_expires_at = None
    publisher.refresh_expires_at = None
    publisher.username = None
    publisher.last_error = None


def recipe_fields(recipe: Recipe) -> dict:
    return dict(title=recipe.pin_title or (recipe.recipe_text or "").split("\n")[0].strip(),
        description=recipe.pin_description or "", board_name=recipe.pin_board or "",
        keywords=recipe.pin_tags or "", article_url=recipe.wp_permalink or "",
        image_url=recipe.pin_design_image or "")


async def sync_queue(db: AsyncSession, site_id: uuid.UUID):
    """Same source and eligibility as the Pinterest gallery, one row per recipe."""
    recipes = (await db.scalars(select(Recipe).where(Recipe.site_id == site_id,
        Recipe.status.in_([RecipeStatus.generated, RecipeStatus.published]),
        ~exists().where(PinterestPublication.site_id == site_id,
            PinterestPublication.recipe_id == Recipe.id)))).all()
    for recipe in recipes:
        values = dict(id=uuid.uuid4(), site_id=site_id, recipe_id=recipe.id, **recipe_fields(recipe),
            status="pending", retry_safe=True, attempt_count=0, created_at=recipe.created_at)
        await db.execute(insert(PinterestPublication).values(**values).on_conflict_do_nothing(
            index_elements=["site_id", "recipe_id"]))
    await db.commit()


async def log_event(db, site_id, event, message, item=None, level="info"):
    # Callers provide curated operational details, never request/response bodies or credentials.
    db.add(PinterestPublishingLog(site_id=site_id, publication_id=item.id if item else None,
        event=event, message=message, level=level))


async def store_tokens(publisher: PinterestPublisher, data: dict):
    now = utcnow()
    publisher.access_token_encrypted = encrypt(data["access_token"])
    publisher.token_expires_at = now + timedelta(seconds=int(data["expires_in"]))
    if data.get("refresh_token"):
        publisher.refresh_token_encrypted = encrypt(data["refresh_token"])
        seconds = data.get("refresh_token_expires_in")
        publisher.refresh_expires_at = now + timedelta(seconds=int(seconds)) if seconds else None


async def access_token(db: AsyncSession, publisher: PinterestPublisher) -> str:
    try:
        return await _access_token(db, publisher)
    except InvalidToken:
        raise api.PinterestError("Saved Pinterest credentials could not be read. Reconnect the account.", reconnect=True) from None


async def _access_token(db: AsyncSession, publisher: PinterestPublisher) -> str:
    if not publisher.access_token_encrypted:
        raise api.PinterestError("Connect a Pinterest account first.", reconnect=True)
    now = utcnow()
    if publisher.connection_method == "token":
        return decrypt(publisher.access_token_encrypted)
    if publisher.token_expires_at and aware(publisher.token_expires_at) > now + timedelta(minutes=5):
        return decrypt(publisher.access_token_encrypted)
    if not publisher.refresh_token_encrypted or (
        publisher.refresh_expires_at and aware(publisher.refresh_expires_at) <= now
    ):
        raise api.PinterestError("Pinterest authorization expired. Reconnect the account.", reconnect=True)
    client_id, client_secret = app_credentials(publisher)
    data = await api.exchange_token(client_id=client_id, client_secret=client_secret,
        grant_type="refresh_token", refresh_token=decrypt(publisher.refresh_token_encrypted))
    await store_tokens(publisher, data)
    await log_event(db, publisher.site_id, "token_refreshed", "Pinterest authorization refreshed securely.")
    await db.commit()
    return decrypt(publisher.access_token_encrypted)


async def daily_usage(db: AsyncSession, site_id: uuid.UUID, now: datetime) -> int:
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    # Unknown outcomes reserve a slot; a known rejection never counts as published.
    return int(await db.scalar(select(func.count()).select_from(PinterestPublication).where(
        PinterestPublication.site_id == site_id,
        or_(PinterestPublication.published_at >= midnight,
            and_(PinterestPublication.dispatched_at >= midnight, PinterestPublication.retry_safe.is_(False)))
    )) or 0)


def next_publication_at(publisher: PinterestPublisher, used: int, now: datetime) -> datetime:
    due = now
    if publisher.last_attempt_at:
        due = max(due, aware(publisher.last_attempt_at) + timedelta(minutes=publisher.interval_minutes))
    if used >= publisher.daily_limit:
        due = max(due, now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1))
    return due


async def recover_interrupted(db: AsyncSession, site_id: uuid.UUID):
    interrupted = (await db.scalars(select(PinterestPublication).where(
        PinterestPublication.site_id == site_id, PinterestPublication.status == "publishing"))).all()
    for item in interrupted:
        await log_event(db, site_id, "attempt_interrupted",
            "Worker interrupted after dispatch. Check Pinterest before retrying." if item.dispatched_at else
            "Worker interrupted before dispatch. Item queued for safe retry.", item, "error")
    # Called only while holding the site lock: no live worker can own these rows.
    await db.execute(update(PinterestPublication).where(PinterestPublication.site_id == site_id,
        PinterestPublication.status == "publishing", PinterestPublication.dispatched_at.is_(None)).values(
            status="failed", retry_safe=True, next_retry_at=utcnow(), error="Publishing interrupted before dispatch; queued for retry."))
    await db.execute(update(PinterestPublication).where(PinterestPublication.site_id == site_id,
        PinterestPublication.status == "publishing", PinterestPublication.dispatched_at.is_not(None)).values(
            status="failed", retry_safe=False, next_retry_at=None,
            error="Publishing was interrupted after dispatch. Check Pinterest and save the existing Pin ID before continuing."))
    await db.commit()


async def still_authorized(db: AsyncSession, publisher: PinterestPublisher) -> bool:
    user = await db.get(User, publisher.user_id)
    site = await db.get(Site, publisher.site_id)
    if not user or not site or user.email.strip().casefold() != ALLOWED_EMAIL:
        return False
    project = await db.get(Project, site.project_id)
    return bool(project and (project.owner_id == user.id or await db.scalar(select(ProjectMember.id).where(
        ProjectMember.project_id == site.project_id, ProjectMember.user_id == user.id))))


async def publish_one(db: AsyncSession, publisher: PinterestPublisher):
    now = utcnow()
    used = await daily_usage(db, publisher.site_id, now)
    if next_publication_at(publisher, used, now) > now:
        return
    item = await db.scalar(select(PinterestPublication).where(
        PinterestPublication.site_id == publisher.site_id, PinterestPublication.pin_id.is_(None),
        or_(PinterestPublication.status == "pending", and_(PinterestPublication.status == "failed",
            PinterestPublication.retry_safe.is_(True), PinterestPublication.next_retry_at <= now,
            PinterestPublication.attempt_count < MAX_AUTO_ATTEMPTS))
    ).order_by(PinterestPublication.created_at, PinterestPublication.id).limit(1).with_for_update())
    if item is None:
        return
    previous_attempt_at = publisher.last_attempt_at
    item.status = "publishing"
    item.attempt_count += 1
    item.attempted_at = now
    item.dispatched_at = None
    item.error = None
    item.next_retry_at = None
    publisher.last_attempt_at = now
    await log_event(db, publisher.site_id, "attempt_started", f"Attempt {item.attempt_count}: {item.title}", item)
    await db.commit()
    try:
        recipe = await db.get(Recipe, item.recipe_id)
        if not recipe or recipe.site_id != publisher.site_id:
            raise api.PinterestError("The source recipe was deleted. This item cannot be published.")
        if recipe.status not in (RecipeStatus.generated, RecipeStatus.published):
            raise api.PinterestError("The source recipe is not ready. Retry after generation completes.")
        for key, value in recipe_fields(recipe).items():
            setattr(item, key, value)
        payload = api.pin_payload(item)
        await log_event(db, publisher.site_id, "content_validated", "Pin image, title and article URL validated. Checking authorization.", item)
        await db.commit()
        token = await access_token(db, publisher)
        # Serializes board discovery/creation across websites using the same account.
        async with locked_session(f"pinterest-boards:{publisher.username.casefold()}") as board_guard:
            if board_guard is None:
                raise api.PinterestError("Another website is preparing a Pinterest board. Retrying later.", retryable=True)
            async def board_progress(event, message):
                await log_event(db, publisher.site_id, event, message, item)
                await db.commit()
            await board_progress("board_search", f"Looking for board: {item.board_name}")
            item.board_id = await api.ensure_board(token, item.board_name, publisher.username, progress=board_progress)
        # A stop can arrive during board lookup. Re-read the row before dispatch.
        await db.refresh(publisher, with_for_update=True)
        dispatch_time = utcnow()
        previous_due = (aware(previous_attempt_at) + timedelta(minutes=publisher.interval_minutes)) if previous_attempt_at else dispatch_time
        if (not publisher.enabled or previous_due > dispatch_time or
            await daily_usage(db, publisher.site_id, dispatch_time) >= publisher.daily_limit):
            item.status = "pending"
            await log_event(db, publisher.site_id, "dispatch_deferred", "Item returned to pending because publishing was stopped or its schedule changed.", item)
            await db.commit()
            return
        item.dispatched_at = utcnow()
        item.retry_safe = False
        await log_event(db, publisher.site_id, "pin_dispatch", f"Sending pin to Pinterest board {item.board_id}. Waiting for its Pin ID.", item)
        await db.commit()  # MUST precede the network write.
        payload["board_id"] = item.board_id
        result = await api.request("POST", "/pins", token, json=payload)
        if not result.get("id"):
            raise api.PinterestError("Pinterest returned no Pin ID. Check Pinterest before retrying.", uncertain=True)
        item.pin_id = str(result["id"])
        item.published_at = utcnow()
        item.status = "published"
        item.retry_safe = False
        item.error = None
        publisher.last_error = None
        publisher.last_attempt_at = utcnow()  # Spacing measured after completion, including across midnight.
        await log_event(db, publisher.site_id, "pin_published", f"Published successfully. Pin ID: {item.pin_id}. Publication date: {item.published_at.isoformat()}.", item)
        await db.commit()
    except api.PinterestError as error:
        item.status = "failed"
        item.error = str(error)
        item.retry_safe = not error.uncertain
        item.next_retry_at = (utcnow() + timedelta(minutes=max(publisher.interval_minutes,
            min(1440, 15 * 2 ** (item.attempt_count - 1))))) if error.retryable and item.attempt_count < MAX_AUTO_ATTEMPTS else None
        publisher.last_error = str(error)
        publisher.last_attempt_at = utcnow()
        if error.reconnect:
            publisher.enabled = False
        retry = f" Automatic retry after {item.next_retry_at.isoformat()}." if item.next_retry_at else (
            " Verify the outcome on Pinterest before retrying." if error.uncertain else " Correct the issue and retry from publishing settings.")
        await log_event(db, publisher.site_id, "pin_failed", str(error) + retry + (" Publishing stopped; reconnect or replace the token." if error.reconnect else ""), item, "error")
        await db.commit()


async def run_site(site_id: uuid.UUID):
    async with site_lock(site_id) as db:
        if db is None:
            return
        await recover_interrupted(db, site_id)
        publisher = await db.get(PinterestPublisher, site_id)
        if not publisher or not publisher.enabled:
            return
        if not await still_authorized(db, publisher):
            publisher.enabled = False
            publisher.last_error = "Publishing access is no longer available for this website."
            await db.commit()
            return
        await sync_queue(db, site_id)
        await publish_one(db, publisher)


async def run_pinterest_scheduler(stop_event: asyncio.Event):
    while not stop_event.is_set():
        try:
            async with SessionLocal() as db:
                site_ids = (await db.scalars(select(PinterestPublisher.site_id).where(
                    or_(PinterestPublisher.enabled.is_(True), PinterestPublisher.site_id.in_(
                        select(PinterestPublication.site_id).where(PinterestPublication.status == "publishing")))))).all()
            for site_id in site_ids:
                if stop_event.is_set():
                    break
                try:
                    await run_site(site_id)
                except Exception:
                    # Never include exception bodies: HTTP credentials can occur in them.
                    logger.error("Pinterest scheduler failed for site %s; durable dispatch state retained", site_id)
        except Exception:
            logger.error("Pinterest scheduler could not read its queue")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=30)
        except asyncio.TimeoutError:
            pass
