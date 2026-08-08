from __future__ import annotations

import threading
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import BackgroundTasks

from app.db_models import FacebookContentStatus, FacebookSpyRow
from app.routes.facebook import (
    FacebookDeliveryBulkPublish,
    cancel_facebook_generation,
    delete_facebook_content,
    publish_facebook_deliveries_bulk,
    publish_facebook_delivery_now,
    replace_facebook_video_and_retry,
    retry_facebook_generation,
)
from app.services.facebook_generation import (
    FacebookGenerationCancelled,
    FacebookGenerationManager,
)


class _Result:
    def __init__(self, *, scalar=None, values=None):
        self._scalar = scalar
        self._values = list(values or [])

    def scalar_one_or_none(self):
        return self._scalar

    def scalar_one(self):
        return self._scalar

    def scalars(self):
        return self

    def all(self):
        return self._values


class _CancelSession:
    def __init__(self, results):
        self._results = iter(results)
        self.added = []
        self.commits = 0
        self.rollbacks = 0
        self.deleted = []

    async def execute(self, _statement):
        return next(self._results)

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def delete(self, item):
        self.deleted.append(item)

    async def flush(self):
        return None


class FacebookManagerControlTests(unittest.TestCase):
    def test_pause_blocks_a_checkpoint_until_resume(self):
        manager = FacebookGenerationManager()
        project_id = uuid.uuid4()
        entered = threading.Event()
        finished = threading.Event()

        manager.pause(project_id)

        def wait_at_checkpoint():
            entered.set()
            manager._checkpoint(project_id)
            finished.set()

        worker = threading.Thread(target=wait_at_checkpoint)
        worker.start()
        self.assertTrue(entered.wait(timeout=1))
        self.assertFalse(finished.wait(timeout=0.1))

        manager.resume(project_id)
        self.assertTrue(finished.wait(timeout=1))
        worker.join(timeout=1)

    def test_cancel_releases_a_paused_checkpoint(self):
        manager = FacebookGenerationManager()
        project_id = uuid.uuid4()
        cancelled = threading.Event()

        manager.pause(project_id)

        def wait_at_checkpoint():
            try:
                manager._checkpoint(project_id)
            except FacebookGenerationCancelled:
                cancelled.set()

        worker = threading.Thread(target=wait_at_checkpoint)
        worker.start()
        manager.cancel(project_id)

        self.assertTrue(cancelled.wait(timeout=1))
        worker.join(timeout=1)


class FacebookCancelRestorationTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancel_returns_only_processing_content_to_spy_sheet(self):
        project_id = uuid.uuid4()
        owner_id = uuid.uuid4()
        content_id = uuid.uuid4()
        project = SimpleNamespace(
            id=project_id,
            owner_id=owner_id,
            generation_paused=True,
        )
        content = SimpleNamespace(
            id=content_id,
            project_id=project_id,
            source_video_url="https://example.com/uploads/source.mp4",
            title="Restored recipe",
            status=FacebookContentStatus.processing,
            generation_cancelled=False,
            error_message=None,
        )
        session = _CancelSession(
            [
                _Result(scalar=project),
                _Result(values=[content]),
                _Result(),
                _Result(scalar=0),
            ]
        )

        with (
            patch("app.routes.facebook.facebook_generation_manager.cancel") as cancel,
            patch(
                "app.routes.facebook.facebook_generation_manager.is_cancelling",
                return_value=False,
            ),
        ):
            result = await cancel_facebook_generation(
                project_id,
                SimpleNamespace(id=owner_id),
                session,
            )

        cancel.assert_called_once_with(project_id)
        restored = [item for item in session.added if isinstance(item, FacebookSpyRow)]
        self.assertEqual(len(restored), 1)
        self.assertEqual(restored[0].direct_link, content.source_video_url)
        self.assertEqual(restored[0].post_title, content.title)
        self.assertTrue(content.generation_cancelled)
        self.assertEqual(content.status, FacebookContentStatus.failed)
        self.assertFalse(project.generation_paused)
        self.assertEqual(result.restored_rows, 1)
        self.assertEqual(result.state, "idle")


class FacebookRetryGenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_retry_resets_only_the_failed_content_and_starts_it_again(self):
        project_id = uuid.uuid4()
        owner_id = uuid.uuid4()
        content_id = uuid.uuid4()
        recipe_id = uuid.uuid4()
        project = SimpleNamespace(
            id=project_id,
            owner_id=owner_id,
            generation_paused=False,
        )
        content = SimpleNamespace(
            id=content_id,
            project_id=project_id,
            source_video_url="https://www.facebook.com/reel/blocked",
            recipe_id=recipe_id,
            screenshot_url="/uploads/old-frame.jpg",
            processed_video_url=None,
            generated_images=None,
            generated_article=None,
            article_url=None,
            status=FacebookContentStatus.failed,
            error_message="Facebook returned HTML",
            generation_cancelled=False,
        )
        session = _CancelSession(
            [
                _Result(scalar=content),
                _Result(scalar=project),
                _Result(),
            ]
        )
        start_batch = AsyncMock()

        with (
            patch(
                "app.routes.facebook.facebook_generation_manager.is_running",
                return_value=False,
            ),
            patch(
                "app.routes.facebook.facebook_generation_manager.is_cancelling",
                return_value=False,
            ),
            patch(
                "app.routes.facebook.facebook_generation_manager.start_batch",
                start_batch,
            ),
        ):
            result = await retry_facebook_generation(
                content_id,
                SimpleNamespace(id=owner_id),
                session,
            )

        self.assertEqual(content.status, FacebookContentStatus.processing)
        self.assertIsNone(content.error_message)
        self.assertIsNone(content.screenshot_url)
        self.assertEqual(content.recipe_id, recipe_id)
        self.assertEqual(result.content_id, content_id)
        start_batch.assert_awaited_once_with(
            facebook_project_id=project_id,
            content_ids=[content_id],
            created_by=owner_id,
        )


    async def test_replace_video_uploads_a_valid_source_and_retries(self):
        project_id = uuid.uuid4()
        owner_id = uuid.uuid4()
        content_id = uuid.uuid4()
        project = SimpleNamespace(
            id=project_id,
            owner_id=owner_id,
            generation_paused=False,
        )
        content = SimpleNamespace(
            id=content_id,
            project_id=project_id,
            source_video_url="https://www.facebook.com/reel/blocked",
            recipe_id=None,
            screenshot_url=None,
            processed_video_url=None,
            generated_images=None,
            generated_article=None,
            article_url=None,
            status=FacebookContentStatus.failed,
            error_message="Facebook login required",
            generation_cancelled=False,
        )
        session = _CancelSession(
            [
                _Result(scalar=content),
                _Result(scalar=project),
                _Result(scalar=content),
                _Result(scalar=project),
                _Result(),
            ]
        )
        start_batch = AsyncMock()
        destination = MagicMock()
        source_url = "https://example.com/uploads/facebook/sources/replacement.mp4"

        with (
            patch(
                "app.routes.facebook._store_facebook_video_upload",
                new=AsyncMock(return_value=(source_url, destination)),
            ) as store_upload,
            patch(
                "app.routes.facebook.facebook_generation_manager.is_running",
                return_value=False,
            ),
            patch(
                "app.routes.facebook.facebook_generation_manager.is_cancelling",
                return_value=False,
            ),
            patch(
                "app.routes.facebook.facebook_generation_manager.start_batch",
                start_batch,
            ),
        ):
            result = await replace_facebook_video_and_retry(
                content_id,
                SimpleNamespace(filename="replacement.mp4"),
                SimpleNamespace(id=owner_id),
                session,
            )

        store_upload.assert_awaited_once()
        destination.unlink.assert_not_called()
        self.assertEqual(content.source_video_url, source_url)
        self.assertEqual(content.status, FacebookContentStatus.processing)
        self.assertEqual(result.content_id, content_id)
        self.assertEqual(session.rollbacks, 1)
        self.assertIn("Source video replaced", session.added[-1].message)
        start_batch.assert_awaited_once_with(
            facebook_project_id=project_id,
            content_ids=[content_id],
            created_by=owner_id,
        )


class FacebookDeleteGenerationTests(unittest.IsolatedAsyncioTestCase):
    async def test_delete_ready_generation_removes_database_row_and_local_assets(self):
        project_id = uuid.uuid4()
        owner_id = uuid.uuid4()
        content_id = uuid.uuid4()
        project = SimpleNamespace(id=project_id, owner_id=owner_id)
        content = SimpleNamespace(
            id=content_id,
            project_id=project_id,
            source_video_url="https://example.com/uploads/facebook/sources/source.mp4",
            processed_video_url="https://example.com/uploads/facebook/item/processed-video.mp4",
            recipe_id=None,
            status=FacebookContentStatus.ready,
        )
        session = _CancelSession(
            [
                _Result(scalar=content),
                _Result(scalar=project),
                _Result(scalar=0),
                _Result(scalar=0),
                _Result(scalar=0),
                _Result(),
            ]
        )
        cleanup = AsyncMock(return_value=(6, 1024, []))

        with (
            patch(
                "app.routes.facebook.facebook_generation_manager.is_running",
                return_value=False,
            ),
            patch("app.routes.facebook.asyncio.to_thread", cleanup),
        ):
            await delete_facebook_content(
                content_id,
                SimpleNamespace(id=owner_id),
                session,
            )

        self.assertEqual(session.deleted, [content])
        self.assertEqual(session.commits, 1)
        cleanup.assert_awaited_once()
        self.assertTrue(cleanup.await_args.kwargs["delete_source"])


class FacebookPublicationQueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_bulk_publication_claims_each_delivery_once(self):
        owner_id = uuid.uuid4()
        delivery_ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
        session = _CancelSession(
            [
                _Result(values=[(delivery_id, owner_id) for delivery_id in delivery_ids]),
                _Result(values=delivery_ids[:2]),
            ]
        )
        background_tasks = BackgroundTasks()

        result = await publish_facebook_deliveries_bulk(
            FacebookDeliveryBulkPublish(delivery_ids=delivery_ids),
            background_tasks,
            SimpleNamespace(id=owner_id),
            session,
        )

        self.assertEqual(result.queued_ids, delivery_ids[:2])
        self.assertEqual(result.skipped_ids, delivery_ids[2:])
        self.assertEqual(session.commits, 1)
        self.assertEqual(len(background_tasks.tasks), 2)
        for queued, delivery_id in zip(background_tasks.tasks, delivery_ids[:2]):
            self.assertEqual(queued.args, (delivery_id,))
            self.assertTrue(queued.kwargs["already_claimed"])

    async def test_manual_publication_is_claimed_before_background_job_is_started(self):
        owner_id = uuid.uuid4()
        delivery_id = uuid.uuid4()
        session = _CancelSession(
            [
                _Result(scalar=owner_id),
                _Result(scalar=delivery_id),
            ]
        )
        background_tasks = BackgroundTasks()

        result = await publish_facebook_delivery_now(
            delivery_id,
            background_tasks,
            SimpleNamespace(id=owner_id),
            session,
        )

        self.assertEqual(result, {"ok": True, "status": "publishing"})
        self.assertEqual(session.commits, 1)
        self.assertEqual(len(background_tasks.tasks), 1)
        queued = background_tasks.tasks[0]
        self.assertEqual(queued.args, (delivery_id,))
        self.assertTrue(queued.kwargs["already_claimed"])


if __name__ == "__main__":
    unittest.main()
