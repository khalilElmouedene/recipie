from __future__ import annotations

import asyncio
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.db_models import (
    FacebookContent, FacebookContentStatus, FacebookDelivery,
    FacebookDeliveryStatus, FacebookGenerationLog, FacebookProject, FacebookSpyRow,
)
from app.routes.facebook import delete_facebook_history
from app.services import facebook_history_cleanup as cleanup


class AsyncSessionAdapter:
    """Exercise real SQL and transactions using SQLite without an async driver."""

    def __init__(self, engine):
        self.session = Session(engine, expire_on_commit=False)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        self.session.close()

    async def execute(self, statement):
        return self.session.execute(statement)

    async def delete(self, item):
        self.session.delete(item)

    async def commit(self):
        self.session.commit()


class FacebookHistoryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine, tables=[
            FacebookProject.__table__, FacebookContent.__table__,
            FacebookDelivery.__table__, FacebookGenerationLog.__table__, FacebookSpyRow.__table__,
        ])
        self.project_id = uuid.uuid4()
        self.owner_id = uuid.uuid4()
        self.now = datetime(2026, 10, 14, 12, tzinfo=timezone.utc)
        self.cutoff = self.now - timedelta(hours=24)
        with Session(self.engine) as db:
            db.add(FacebookProject(
                id=self.project_id, owner_id=self.owner_id,
                content_project_id=uuid.uuid4(), name="History tests",
            ))
            db.commit()
        self.session_patch = patch.object(
            cleanup, "SessionLocal", side_effect=lambda: AsyncSessionAdapter(self.engine),
        )
        self.files_patch = patch.object(cleanup, "delete_facebook_content_files", return_value=(3, 100, []))
        self.running_patch = patch.object(cleanup.facebook_generation_manager, "is_running", return_value=False)
        self.session_patch.start()
        self.files = self.files_patch.start()
        self.running_patch.start()
        self.addCleanup(self.session_patch.stop)
        self.addCleanup(self.files_patch.stop)
        self.addCleanup(self.running_patch.stop)
        self.addCleanup(self.engine.dispose)

    def add_content(self, statuses, *, project_id=None, hours_ago=25, status=FacebookContentStatus.ready, missing_time=False):
        content_id = uuid.uuid4()
        with Session(self.engine) as db:
            db.add(FacebookContent(
                id=content_id, project_id=project_id or self.project_id,
                source_video_url=f"/uploads/facebook/sources/{content_id}.mp4",
                title="Published recipe", status=status,
            ))
            for delivery_status in statuses:
                db.add(FacebookDelivery(
                    content_id=content_id, page_id=uuid.uuid4(), status=delivery_status,
                    published_at=None if missing_time else self.now - timedelta(hours=hours_ago),
                ))
            db.commit()
        return content_id

    def remaining_ids(self):
        with Session(self.engine) as db:
            return set(db.scalars(select(FacebookContent.id)))

    async def test_manual_deletion_removes_all_published_deliveries_only_in_requested_project(self):
        deleted = self.add_content([FacebookDeliveryStatus.published] * 2, hours_ago=1)
        other = self.add_content([FacebookDeliveryStatus.published], project_id=uuid.uuid4())
        result = await cleanup.cleanup_published_facebook_history(self.project_id)
        self.assertEqual(result, {"deleted": 1, "skipped": 0, "failed": 0})
        self.assertEqual(self.remaining_ids(), {other})
        with Session(self.engine) as db:
            self.assertEqual(list(db.scalars(select(FacebookDelivery).where(FacebookDelivery.content_id == deleted))), [])

    async def test_daily_cleanup_preserves_recent_missing_time_and_unfinished_deliveries(self):
        old = self.add_content([FacebookDeliveryStatus.published], hours_ago=25)
        boundary = self.add_content([FacebookDeliveryStatus.published], hours_ago=24)
        kept = {
            self.add_content([FacebookDeliveryStatus.published], hours_ago=23),
            self.add_content([FacebookDeliveryStatus.published], missing_time=True),
            self.add_content([]),
            self.add_content([FacebookDeliveryStatus.published], status=FacebookContentStatus.processing),
        }
        for status in FacebookDeliveryStatus:
            if status != FacebookDeliveryStatus.published:
                kept.add(self.add_content([FacebookDeliveryStatus.published, status]))
        # Retention starts after the last Page has published.
        multi_page = self.add_content([FacebookDeliveryStatus.published] * 2)
        with Session(self.engine) as db:
            delivery = db.scalars(select(FacebookDelivery).where(FacebookDelivery.content_id == multi_page)).first()
            delivery.published_at = self.now - timedelta(hours=2)
            db.commit()
        kept.add(multi_page)
        result = await cleanup.cleanup_published_facebook_history(before=self.cutoff)
        self.assertEqual(result["deleted"], 2)
        self.assertEqual(self.remaining_ids(), kept)
        self.assertNotIn(old, self.remaining_ids())
        self.assertNotIn(boundary, self.remaining_ids())

    async def test_item_rechecks_delivery_status_and_retention(self):
        for statuses, hours in [
            ([FacebookDeliveryStatus.published, FacebookDeliveryStatus.scheduled], 25),
            ([FacebookDeliveryStatus.published], 1),
        ]:
            content_id = self.add_content(statuses, hours_ago=hours)
            self.assertFalse(await cleanup.delete_published_history_item(content_id, self.cutoff))
        self.files.assert_not_called()

    async def test_shared_source_is_preserved(self):
        content_id = self.add_content([FacebookDeliveryStatus.published])
        with Session(self.engine) as db:
            content = db.get(FacebookContent, content_id)
            db.add(FacebookSpyRow(project_id=self.project_id, direct_link=content.source_video_url, post_title="Queued source"))
            db.commit()
        await cleanup.cleanup_published_facebook_history(self.project_id)
        self.assertFalse(self.files.call_args.kwargs["delete_source"])

    async def test_running_generation_and_cancelled_content_are_preserved(self):
        active = self.add_content([FacebookDeliveryStatus.published])
        with patch.object(cleanup.facebook_generation_manager, "is_running", return_value=True):
            result = await cleanup.cleanup_published_facebook_history(self.project_id)
        self.assertEqual(result["skipped"], 1)
        self.assertIn(active, self.remaining_ids())
        with Session(self.engine) as db:
            db.get(FacebookContent, active).generation_cancelled = True
            db.commit()
        self.assertFalse(await cleanup.delete_published_history_item(active, None))
        self.files.assert_not_called()

    async def test_file_failure_keeps_history_for_retry_and_continues_other_posts(self):
        first = self.add_content([FacebookDeliveryStatus.published])
        second = self.add_content([FacebookDeliveryStatus.published])
        self.files.side_effect = [(0, 0, ["locked.mp4"]), (1, 20, [])]
        with self.assertLogs(cleanup.logger, level="ERROR"):
            result = await cleanup.cleanup_published_facebook_history(self.project_id)
        self.assertEqual(result, {"deleted": 1, "skipped": 0, "failed": 1})
        self.assertEqual(len(self.remaining_ids() & {first, second}), 1)

    async def test_route_rejects_other_owners_before_cleanup(self):
        async with AsyncSessionAdapter(self.engine) as db:
            with patch.object(cleanup, "cleanup_published_facebook_history", new_callable=AsyncMock) as run:
                with self.assertRaises(HTTPException) as raised:
                    await delete_facebook_history(self.project_id, SimpleNamespace(id=uuid.uuid4()), db)
                self.assertEqual(raised.exception.status_code, 403)
                run.assert_not_awaited()

    async def test_route_scopes_deletion_to_owner_project(self):
        content_id = self.add_content([FacebookDeliveryStatus.published])
        async with AsyncSessionAdapter(self.engine) as db:
            result = await delete_facebook_history(self.project_id, SimpleNamespace(id=self.owner_id), db)
        self.assertEqual(result["deleted"], 1)
        self.assertNotIn(content_id, self.remaining_ids())

    async def test_scheduler_runs_on_startup_and_stops_promptly(self):
        stop = asyncio.Event()

        async def run_pass(**kwargs):
            self.assertAlmostEqual((datetime.now(timezone.utc) - kwargs["before"]).total_seconds(), 86400, delta=2)
            stop.set()
            return {"deleted": 0, "skipped": 0, "failed": 0}

        with patch.object(cleanup, "cleanup_published_facebook_history", side_effect=run_pass) as run:
            await asyncio.wait_for(cleanup.run_facebook_history_cleanup(stop), timeout=1)
        run.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
