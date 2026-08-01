from __future__ import annotations

import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.db_models import FacebookCommentMode
from app.services import facebook_api
from app.services.facebook_publisher import (
    build_first_comment,
    publish_facebook_delivery,
    recover_interrupted_facebook_deliveries,
)


class _ScalarResult:
    def __init__(self, values: list[uuid.UUID]):
        self._values = values

    def scalars(self):
        return iter(self._values)


class _FakeSession:
    def __init__(self):
        self.execute_calls = 0
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def execute(self, _statement):
        self.execute_calls += 1
        count = 2 if self.execute_calls == 1 else 1
        return _ScalarResult([uuid.uuid4() for _ in range(count)])

    async def commit(self):
        self.commits += 1


class _ExecutionResult:
    def __init__(self, *, scalar=None, row=None):
        self._scalar = scalar
        self._row = row

    def scalar_one_or_none(self):
        return self._scalar

    def one(self):
        return self._row


class _QueuedSession:
    def __init__(self, results: list[_ExecutionResult]):
        self._results = iter(results)
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def execute(self, _statement):
        return next(self._results)

    async def commit(self):
        self.commits += 1


class FacebookFirstCommentTests(unittest.TestCase):
    def test_full_recipe_mode_does_not_include_article_url(self):
        self.assertEqual(
            build_first_comment(FacebookCommentMode.full_recipe, "https://example.com/recipe"),
            "Full Recipe",
        )

    def test_full_recipe_url_mode_includes_published_article_url(self):
        self.assertEqual(
            build_first_comment(
                FacebookCommentMode.full_recipe_url,
                "https://example.com/recipe",
            ),
            "Full Recipe\nhttps://example.com/recipe",
        )


class FacebookRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_recovery_reports_all_interrupted_deliveries(self):
        session = _FakeSession()
        with patch(
            "app.services.facebook_publisher.SessionLocal",
            return_value=session,
        ):
            recovered = await recover_interrupted_facebook_deliveries()

        self.assertEqual(recovered, 3)
        self.assertEqual(session.execute_calls, 2)
        self.assertEqual(session.commits, 1)


class FacebookPublishingWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_article_is_published_before_video_and_first_comment(self):
        delivery_id = uuid.uuid4()
        content_id = uuid.uuid4()
        delivery = SimpleNamespace(
            facebook_post_id=None,
            first_comment_id=None,
        )
        content = SimpleNamespace(
            id=content_id,
            processed_video_url="https://example.com/uploads/facebook/video.mp4",
            title="Recipe title",
        )
        page = SimpleNamespace(
            access_token="encrypted-page-token",
            facebook_page_id="page-42",
            comment_mode=FacebookCommentMode.full_recipe_url,
        )
        sessions = iter(
            [
                _QueuedSession([_ExecutionResult(scalar=delivery_id)]),
                _QueuedSession([_ExecutionResult(row=(delivery, content, page))]),
                _QueuedSession([_ExecutionResult()]),
                _QueuedSession([_ExecutionResult()]),
            ]
        )
        order: list[str] = []

        async def publish_article(_content_id):
            order.append("article")
            return "https://example.com/recipe"

        def publish_video(**_kwargs):
            order.append("video")
            return "video-123"

        def publish_comment(**kwargs):
            order.append("comment")
            self.assertEqual(
                kwargs["message"],
                "Full Recipe\nhttps://example.com/recipe",
            )
            return "comment-456"

        with (
            patch(
                "app.services.facebook_publisher.SessionLocal",
                side_effect=lambda: next(sessions),
            ),
            patch("app.services.facebook_publisher.decrypt", return_value="page-token"),
            patch(
                "app.services.facebook_publisher._ensure_article_published",
                new=AsyncMock(side_effect=publish_article),
            ),
            patch.object(facebook_api, "publish_video", side_effect=publish_video),
            patch.object(facebook_api, "add_first_comment", side_effect=publish_comment),
        ):
            published = await publish_facebook_delivery(delivery_id)

        self.assertTrue(published)
        self.assertEqual(order, ["article", "video", "comment"])


if __name__ == "__main__":
    unittest.main()
