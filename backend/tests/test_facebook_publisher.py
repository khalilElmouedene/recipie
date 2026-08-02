from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.config import settings
from app.db_models import FacebookCommentMode
from app.db_models import FacebookDeliveryStatus
from app.services import facebook_api
from app.services.facebook_publisher import (
    _ensure_article_published,
    _delete_content_video_files,
    build_first_comment,
    cleanup_published_facebook_content_video,
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

    def one_or_none(self):
        return self._row


class _CleanupResult:
    def __init__(self, *, scalar=None, rows=None):
        self._scalar = scalar
        self._rows = rows or []

    def scalar_one_or_none(self):
        return self._scalar

    def scalar_one(self):
        return self._scalar

    def all(self):
        return self._rows


class _CleanupSession:
    def __init__(self, results: list[_CleanupResult]):
        self._results = iter(results)
        self.added = []
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def execute(self, _statement):
        return next(self._results)

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.commits += 1


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
        recipe = "Creamy Garlic Sauce\n\nIngredients\n- 2 cloves garlic\n\nInstructions\n1. Blend."
        self.assertEqual(
            build_first_comment(
                FacebookCommentMode.full_recipe,
                recipe,
                "https://example.com/recipe",
            ),
            recipe,
        )

    def test_full_recipe_url_mode_includes_published_article_url(self):
        recipe = "Creamy Garlic Sauce\n\nIngredients\n- 2 cloves garlic\n\nInstructions\n1. Blend."
        self.assertEqual(
            build_first_comment(
                FacebookCommentMode.full_recipe_url,
                recipe,
                "https://example.com/recipe",
            ),
            f"{recipe}\n\nhttps://example.com/recipe",
        )

    def test_missing_generated_recipe_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "generated full recipe is missing"):
            build_first_comment(
                FacebookCommentMode.full_recipe,
                "",
                "https://example.com/recipe",
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
    async def test_retry_reuses_existing_wordpress_article(self):
        content_id = uuid.uuid4()
        article_url = "https://example.com/already-published-recipe"
        content = SimpleNamespace(article_url=article_url)
        session = _QueuedSession(
            [
                _ExecutionResult(
                    row=(content, SimpleNamespace(), SimpleNamespace(), SimpleNamespace())
                )
            ]
        )

        with (
            patch(
                "app.services.facebook_publisher.SessionLocal",
                return_value=session,
            ),
            patch(
                "app.services.facebook_publisher.publish_recipe",
                side_effect=AssertionError("WordPress article must not be published twice"),
            ),
        ):
            result = await _ensure_article_published(content_id)

        self.assertEqual(result, article_url)

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
        recipe = SimpleNamespace(
            generated_full_recipe=(
                "Creamy Garlic Sauce\n\nIngredients\n- 2 cloves garlic\n\n"
                "Instructions\n1. Blend until smooth."
            ),
        )
        sessions = iter(
            [
                _QueuedSession([_ExecutionResult(scalar=delivery_id)]),
                _QueuedSession([_ExecutionResult(row=(delivery, content, page, recipe))]),
                _QueuedSession([_ExecutionResult()]),
                _QueuedSession([_ExecutionResult()]),
            ]
        )
        order: list[str] = []

        async def validate_video_source(**_kwargs):
            order.append("video-preflight")

        async def publish_article(_content_id):
            order.append("article")
            return "https://example.com/recipe"

        def start_reel(**_kwargs):
            order.append("reel-start")
            return "video-123", "https://rupload.facebook.com/video-upload/v24.0/video-123"

        def upload_reel(**_kwargs):
            order.append("reel-upload")

        def finish_reel(**_kwargs):
            order.append("reel-finish")

        def wait_for_reel(**_kwargs):
            order.append("reel-ready")
            return {"video_status": "ready"}

        def publish_comment(**kwargs):
            order.append("comment")
            self.assertEqual(
                kwargs["message"],
                f"{recipe.generated_full_recipe}\n\nhttps://example.com/recipe",
            )
            return "comment-456"

        with (
            patch(
                "app.services.facebook_publisher.SessionLocal",
                side_effect=lambda: next(sessions),
            ),
            patch("app.services.facebook_publisher.decrypt", return_value="page-token"),
            patch(
                "app.services.facebook_publisher._validate_reel_upload_source",
                new=AsyncMock(side_effect=validate_video_source),
            ),
            patch(
                "app.services.facebook_publisher._ensure_article_published",
                new=AsyncMock(side_effect=publish_article),
            ),
            patch.object(facebook_api, "start_reel_upload", side_effect=start_reel),
            patch.object(facebook_api, "upload_hosted_reel", side_effect=upload_reel),
            patch.object(facebook_api, "finish_reel_publish", side_effect=finish_reel),
            patch.object(
                facebook_api,
                "wait_for_reel_published",
                side_effect=wait_for_reel,
            ),
            patch.object(facebook_api, "add_first_comment", side_effect=publish_comment),
            patch(
                "app.services.facebook_publisher.cleanup_published_facebook_content_video",
                new=AsyncMock(return_value=False),
            ) as cleanup,
        ):
            published = await publish_facebook_delivery(delivery_id)

        self.assertTrue(published)
        self.assertEqual(
            order,
            [
                "video-preflight",
                "article",
                "reel-start",
                "reel-upload",
                "reel-finish",
                "reel-ready",
                "comment",
            ],
        )
        cleanup.assert_awaited_once_with(content_id)

    async def test_invalid_reel_is_reported_before_wordpress_is_published(self):
        delivery_id = uuid.uuid4()
        content = SimpleNamespace(
            id=uuid.uuid4(),
            processed_video_url="https://example.com/uploads/facebook/video.mp4",
            title="Recipe title",
        )
        delivery = SimpleNamespace(facebook_post_id=None, first_comment_id=None)
        page = SimpleNamespace(
            access_token="encrypted-page-token",
            facebook_page_id="page-42",
            comment_mode=FacebookCommentMode.full_recipe,
        )
        recipe = SimpleNamespace(generated_full_recipe="Ingredients\n- Garlic")
        sessions = iter(
            [
                _QueuedSession([_ExecutionResult(scalar=delivery_id)]),
                _QueuedSession([_ExecutionResult(row=(delivery, content, page, recipe))]),
                _QueuedSession([_ExecutionResult()]),
            ]
        )
        publish_article = AsyncMock(return_value="https://example.com/recipe")

        with (
            patch(
                "app.services.facebook_publisher.SessionLocal",
                side_effect=lambda: next(sessions),
            ),
            patch("app.services.facebook_publisher.decrypt", return_value="page-token"),
            patch(
                "app.services.facebook_publisher._validate_reel_upload_source",
                new=AsyncMock(
                    side_effect=ValueError(
                        "Generated video is not publishable as a Facebook Reel: "
                        "duration is 72.0s; Facebook Reels require 4-60s."
                    )
                ),
            ),
            patch(
                "app.services.facebook_publisher._ensure_article_published",
                new=publish_article,
            ),
        ):
            published = await publish_facebook_delivery(delivery_id)

        self.assertFalse(published)
        publish_article.assert_not_awaited()

    async def test_interrupted_reel_upload_resumes_without_creating_a_duplicate(self):
        delivery_id = uuid.uuid4()
        content_id = uuid.uuid4()
        delivery = SimpleNamespace(
            facebook_post_id="video-existing",
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
            comment_mode=FacebookCommentMode.full_recipe,
        )
        recipe = SimpleNamespace(generated_full_recipe="Ingredients\n- Garlic\n\nInstructions\n1. Blend.")
        sessions = iter(
            [
                _QueuedSession([_ExecutionResult(scalar=delivery_id)]),
                _QueuedSession([_ExecutionResult(row=(delivery, content, page, recipe))]),
                _QueuedSession([_ExecutionResult()]),
            ]
        )
        order: list[str] = []
        interrupted_status = {
            "video_status": "processing",
            "uploading_phase": {"status": "complete"},
            "processing_phase": {"status": "not_started"},
            "publishing_phase": {"status": "not_started"},
        }

        async def publish_article(_content_id):
            order.append("article")
            return "https://example.com/recipe"

        def finish_reel(**kwargs):
            order.append("reel-finish")
            self.assertEqual(kwargs["video_id"], "video-existing")

        def wait_for_reel(**_kwargs):
            order.append("reel-ready")
            return {"video_status": "ready"}

        def publish_comment(**_kwargs):
            order.append("comment")
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
            patch.object(
                facebook_api,
                "get_reel_status",
                return_value=interrupted_status,
            ),
            patch.object(
                facebook_api,
                "start_reel_upload",
                side_effect=AssertionError("must not create a duplicate Reel"),
            ),
            patch.object(
                facebook_api,
                "upload_hosted_reel",
                side_effect=AssertionError("completed upload must not be repeated"),
            ),
            patch.object(
                facebook_api,
                "finish_reel_publish",
                side_effect=finish_reel,
            ),
            patch.object(
                facebook_api,
                "wait_for_reel_published",
                side_effect=wait_for_reel,
            ),
            patch.object(
                facebook_api,
                "add_first_comment",
                side_effect=publish_comment,
            ),
            patch(
                "app.services.facebook_publisher.cleanup_published_facebook_content_video",
                new=AsyncMock(return_value=False),
            ),
        ):
            published = await publish_facebook_delivery(delivery_id)

        self.assertTrue(published)
        self.assertEqual(
            order,
            ["article", "reel-finish", "reel-ready", "comment"],
        )


class FacebookPublishedVideoCleanupTests(unittest.IsolatedAsyncioTestCase):
    async def test_cleanup_waits_until_every_page_delivery_is_published(self):
        content_id = uuid.uuid4()
        content = SimpleNamespace(
            id=content_id,
            project_id=uuid.uuid4(),
            source_video_url="https://example.com/video.mp4",
            processed_video_url="https://example.com/uploads/facebook/processed.mp4",
        )
        session = _CleanupSession(
            [
                _CleanupResult(scalar=content),
                _CleanupResult(
                    rows=[
                        (FacebookDeliveryStatus.published, datetime.now(timezone.utc)),
                        (FacebookDeliveryStatus.scheduled, None),
                    ]
                ),
            ]
        )
        with (
            patch("app.services.facebook_publisher.SessionLocal", return_value=session),
            patch(
                "app.services.facebook_publisher._delete_content_video_files"
            ) as delete_files,
        ):
            cleaned = await cleanup_published_facebook_content_video(
                content_id,
                retention_hours=0,
            )

        self.assertFalse(cleaned)
        self.assertEqual(content.processed_video_url, "https://example.com/uploads/facebook/processed.mp4")
        delete_files.assert_not_called()

    async def test_cleanup_clears_video_url_after_retention_window(self):
        now = datetime.now(timezone.utc)
        content_id = uuid.uuid4()
        content = SimpleNamespace(
            id=content_id,
            project_id=uuid.uuid4(),
            source_video_url=f"{settings.server_base_url.rstrip('/')}/uploads/facebook/sources/source.mp4",
            processed_video_url=(
                f"{settings.server_base_url.rstrip('/')}/uploads/facebook/"
                f"{content_id}/processed-video.mp4"
            ),
        )
        session = _CleanupSession(
            [
                _CleanupResult(scalar=content),
                _CleanupResult(
                    rows=[
                        (
                            FacebookDeliveryStatus.published,
                            now - timedelta(hours=2),
                        )
                    ]
                ),
                _CleanupResult(scalar=0),
                _CleanupResult(scalar=0),
            ]
        )
        with (
            patch("app.services.facebook_publisher.SessionLocal", return_value=session),
            patch(
                "app.services.facebook_publisher._delete_content_video_files",
                return_value=(4, 8 * 1024 * 1024, []),
            ) as delete_files,
        ):
            cleaned = await cleanup_published_facebook_content_video(
                content_id,
                now=now,
                retention_hours=1,
            )

        self.assertTrue(cleaned)
        self.assertIsNone(content.processed_video_url)
        self.assertEqual(session.commits, 1)
        self.assertEqual(session.added[0].stage, "cleanup")
        self.assertIn("freed 8.0 MB", session.added[0].message)
        delete_files.assert_called_once()

    def test_file_cleanup_removes_only_video_files_and_the_unshared_source(self):
        content_id = uuid.uuid4()
        facebook_root = MagicMock()
        source_root = MagicMock()
        work_dir_expression = MagicMock()
        work_dir = MagicMock()
        facebook_root.__truediv__.return_value = work_dir_expression
        work_dir_expression.resolve.return_value = work_dir
        facebook_root.resolve.return_value = facebook_root
        source_root.resolve.return_value = source_root
        work_dir.is_dir.return_value = True

        def video_path(name: str, size: int) -> MagicMock:
            path = MagicMock()
            path.is_file.return_value = True
            path.suffix = name[name.rfind(".") :]
            path.resolve.return_value = path
            path.stat.return_value.st_size = size
            path.__str__.return_value = name
            return path

        work_videos = [
            video_path("source.mp4", 2048),
            video_path("source-silent.mp4", 2048),
            video_path("processed-video.mp4", 2048),
        ]
        screenshot = video_path("first-frame.jpg", 5)
        work_dir.iterdir.return_value = [*work_videos, screenshot]
        processed_path = work_videos[-1]
        source_path = video_path("uploaded-source.mp4", 1024)

        with (
            patch("app.services.facebook_publisher.FACEBOOK_UPLOADS_ROOT", facebook_root),
            patch("app.services.facebook_publisher.FACEBOOK_SOURCE_ROOT", source_root),
            patch(
                "app.services.facebook_publisher._local_upload_path",
                side_effect=[processed_path, source_path],
            ),
        ):
            deleted_count, deleted_bytes, failures = _delete_content_video_files(
                content_id,
                source_video_url="https://example.com/uploads/facebook/sources/source.mp4",
                processed_video_url="https://example.com/uploads/facebook/processed.mp4",
                delete_source=True,
            )

        self.assertEqual(deleted_count, 4)
        self.assertEqual(deleted_bytes, 7 * 1024)
        self.assertEqual(failures, [])
        screenshot.unlink.assert_not_called()
        source_path.unlink.assert_called_once_with(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
