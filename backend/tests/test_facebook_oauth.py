from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from jose import jwt

from app.config import settings
from app.db_models import FacebookCommentMode
from app.routes.facebook import (
    FacebookOAuthCallbackBody,
    facebook_oauth_callback,
    facebook_oauth_url,
)
from app.services import facebook_api


class _ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _ReconnectDb:
    def __init__(self, page):
        self.page = page
        self.commits = 0
        self.refreshes = 0

    async def execute(self, _statement):
        return _ScalarResult(self.page)

    async def commit(self):
        self.commits += 1

    async def refresh(self, _value):
        self.refreshes += 1


def _page(project_id: uuid.UUID):
    return SimpleNamespace(
        id=uuid.uuid4(),
        project_id=project_id,
        facebook_page_id="page-42",
        name="Recipe Page",
        picture_url="https://example.com/old.jpg",
        access_token="encrypted-old-token",
        token_expires_at=None,
        comment_mode=FacebookCommentMode.full_recipe_url,
        publish_start_time="12:00",
        publish_end_time="19:00",
        max_posts_per_day=3,
        interval_minutes=180,
        timezone="Africa/Casablanca",
        created_at=datetime.now(timezone.utc),
    )


class FacebookReconnectOAuthTests(unittest.IsolatedAsyncioTestCase):
    async def test_oauth_state_identifies_the_page_selected_for_reconnection(self):
        project_id = uuid.uuid4()
        user = SimpleNamespace(id=uuid.uuid4())
        project = SimpleNamespace(id=project_id)
        page = _page(project_id)
        captured = {}

        def oauth_url(**kwargs):
            captured.update(kwargs)
            return "https://www.facebook.com/dialog/oauth"

        with (
            patch("app.routes.facebook._project", new=AsyncMock(return_value=project)),
            patch(
                "app.routes.facebook._page",
                new=AsyncMock(return_value=(page, project)),
            ),
            patch(
                "app.routes.facebook._app_credentials",
                return_value=("app-id", "app-secret"),
            ),
            patch.object(facebook_api, "get_oauth_url", side_effect=oauth_url),
        ):
            await facebook_oauth_url(
                project_id=project_id,
                user=user,
                db=AsyncMock(),
                comment_mode="full_recipe",
                reconnect_page_id=page.id,
            )

        state = jwt.decode(
            captured["state"],
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
        self.assertEqual(state["facebook_project_id"], str(project_id))
        self.assertEqual(state["reconnect_page_id"], str(page.id))

    async def test_reconnection_refreshes_only_token_and_identity_fields(self):
        project_id = uuid.uuid4()
        user = SimpleNamespace(id=uuid.uuid4())
        project = SimpleNamespace(id=project_id)
        page = _page(project_id)
        db = _ReconnectDb(page)
        state = jwt.encode(
            {
                "facebook_project_id": str(project_id),
                "user_id": str(user.id),
                "comment_mode": "full_recipe",
                "reconnect_page_id": str(page.id),
            },
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )

        with (
            patch("app.routes.facebook._project", new=AsyncMock(return_value=project)),
            patch(
                "app.routes.facebook._app_credentials",
                return_value=("app-id", "app-secret"),
            ),
            patch.object(
                facebook_api,
                "exchange_code_for_user_token",
                return_value={"access_token": "short-user-token"},
            ),
            patch.object(
                facebook_api,
                "exchange_for_long_lived_user_token",
                return_value={"access_token": "long-user-token", "expires_in": 3600},
            ),
            patch.object(
                facebook_api,
                "get_managed_pages",
                return_value=[
                    {
                        "id": "page-42",
                        "name": "Recipe Page Updated",
                        "picture_url": "https://example.com/new.jpg",
                        "access_token": "fresh-page-token",
                    },
                    {
                        "id": "other-page",
                        "name": "Other Page",
                        "picture_url": None,
                        "access_token": "other-token",
                    },
                ],
            ),
            patch("app.routes.facebook.encrypt", return_value="encrypted-fresh-token"),
        ):
            result = await facebook_oauth_callback(
                body=FacebookOAuthCallbackBody(code="oauth-code", state=state),
                user=user,
                db=db,
            )

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].id, page.id)
        self.assertEqual(page.access_token, "encrypted-fresh-token")
        self.assertEqual(page.name, "Recipe Page Updated")
        self.assertEqual(page.picture_url, "https://example.com/new.jpg")
        self.assertEqual(page.comment_mode, FacebookCommentMode.full_recipe_url)
        self.assertEqual(page.publish_start_time, "12:00")
        self.assertEqual(page.max_posts_per_day, 3)
        self.assertEqual(page.interval_minutes, 180)
        self.assertEqual(db.commits, 1)
        self.assertEqual(db.refreshes, 1)


if __name__ == "__main__":
    unittest.main()
