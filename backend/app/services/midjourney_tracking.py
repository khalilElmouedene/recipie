from __future__ import annotations

import asyncio
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, TypeVar

from sqlalchemy import select

from app.database import SessionLocal
from app.db_models import MidjourneyGeneration


T = TypeVar("T")

_database_loop: asyncio.AbstractEventLoop | None = None
_database_loop_lock = threading.Lock()

_TRACKING_FIELDS = {
    "status",
    "attempt_count",
    "recipe_name",
    "source_image_url",
    "prompt",
    "discord_application_id",
    "discord_guild_id",
    "discord_channel_id",
    "discord_command_version",
    "discord_command_id",
    "discord_session_id",
    "interaction_nonce",
    "baseline_message_id",
    "tracked_message_id",
    "grid_message_id",
    "grid_custom_ids",
    "grid_job_tokens",
    "upscale_baseline_message_id",
    "requested_custom_ids",
    "expected_upscale_count",
    "result_message_ids",
    "image_urls",
    "cached_image_urls",
    "last_error",
    "submitted_at",
    "grid_ready_at",
    "delayed_at",
    "completed_at",
    "last_polled_at",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def bind_tracking_event_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    """Bind worker-thread writes to FastAPI's database event loop."""
    global _database_loop
    with _database_loop_lock:
        _database_loop = loop


def _run_async(factory: Callable[[], Awaitable[T]]) -> T:
    """Run an async database operation from either a worker or event-loop thread."""
    with _database_loop_lock:
        database_loop = _database_loop
    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        current_loop = None

    if database_loop is not None and database_loop.is_running():
        if current_loop is database_loop:
            raise RuntimeError(
                "Blocking Midjourney tracking writes cannot run on the FastAPI event-loop thread"
            )
        return asyncio.run_coroutine_threadsafe(factory(), database_loop).result()

    if current_loop is None:
        return asyncio.run(factory())

    result: list[T] = []
    error: list[BaseException] = []

    def runner() -> None:
        try:
            result.append(asyncio.run(factory()))
        except BaseException as exc:  # pragma: no cover - defensive bridge
            error.append(exc)

    thread = threading.Thread(target=runner, name="midjourney-tracking-db", daemon=True)
    thread.start()
    thread.join()
    if error:
        raise error[0]
    return result[0]


def _snapshot(row: MidjourneyGeneration) -> dict[str, Any]:
    return {
        field: getattr(row, field)
        for field in _TRACKING_FIELDS
    } | {
        "id": str(row.id),
        "recipe_id": str(row.recipe_id),
    }


class MidjourneyTrackingStore:
    """Synchronous facade used by the blocking Discord generation worker."""

    def __init__(self, recipe_id: str | uuid.UUID):
        self.recipe_id = uuid.UUID(str(recipe_id))

    async def _load_or_create(self, initial: dict[str, Any]) -> dict[str, Any]:
        async with SessionLocal() as session:
            row = (
                await session.execute(
                    select(MidjourneyGeneration)
                    .where(MidjourneyGeneration.recipe_id == self.recipe_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if row is None:
                row = MidjourneyGeneration(recipe_id=self.recipe_id)
                session.add(row)
            for key, value in initial.items():
                if key in _TRACKING_FIELDS and value is not None:
                    setattr(row, key, value)
            row.attempt_count = int(row.attempt_count or 0) + 1
            await session.commit()
            await session.refresh(row)
            return _snapshot(row)

    def load_or_create(self, **initial: Any) -> dict[str, Any]:
        return _run_async(lambda: self._load_or_create(initial))

    async def _update(self, values: dict[str, Any]) -> dict[str, Any]:
        async with SessionLocal() as session:
            row = (
                await session.execute(
                    select(MidjourneyGeneration)
                    .where(MidjourneyGeneration.recipe_id == self.recipe_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if row is None:
                row = MidjourneyGeneration(recipe_id=self.recipe_id)
                session.add(row)
            for key, value in values.items():
                if key in _TRACKING_FIELDS:
                    setattr(row, key, value)
            await session.commit()
            await session.refresh(row)
            return _snapshot(row)

    def update(self, **values: Any) -> dict[str, Any]:
        return _run_async(lambda: self._update(values))
