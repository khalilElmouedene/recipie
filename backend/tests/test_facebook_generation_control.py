from __future__ import annotations

import threading
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.db_models import FacebookContentStatus, FacebookSpyRow
from app.routes.facebook import cancel_facebook_generation, retry_facebook_generation
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

    async def execute(self, _statement):
        return next(self._results)

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        self.commits += 1

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
        project = SimpleNamespace(
            id=project_id,
            owner_id=owner_id,
            generation_paused=False,
        )
        content = SimpleNamespace(
            id=content_id,
            project_id=project_id,
            recipe_id=None,
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
        self.assertEqual(result.content_id, content_id)
        start_batch.assert_awaited_once_with(
            facebook_project_id=project_id,
            content_ids=[content_id],
            created_by=owner_id,
        )


if __name__ == "__main__":
    unittest.main()
