from __future__ import annotations

import os
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "pinterest-sheet-test-" * 4)
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())

from fastapi import HTTPException
from app.db_models import RecipeStatus
from app.routes.recipes import prepare_pinterest_sheet_recipe
from app.services.pinterest_sheet import generated_image_urls


class PinterestSheetTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.user = SimpleNamespace(id=uuid.uuid4(), email="khalil@gmail.com")
        self.recipe = SimpleNamespace(
            site_id=uuid.uuid4(), generated_images='["https://cdn.example.com/one.jpg", "https://cdn.example.com/two.jpg"]',
            pin_title="Soup", recipe_text="Soup\nIngredients", pin_description="Cozy soup.",
            pin_tags="soup, dinner", pin_blog_link=None, wp_permalink="https://example.com/soup",
            status=RecipeStatus.published, pin_board="Dinner", generated_article="Soup article",
            generated_full_recipe=None,
        )
        self.site = SimpleNamespace(project_id=uuid.uuid4())
        self.db = AsyncMock()
        self.db.get.side_effect = [self.recipe, self.site, None]
        self.access = patch("app.routes.recipes.check_project_access", new_callable=AsyncMock)
        self.access_mock = self.access.start()
        self.addCleanup(self.access.stop)

    async def prepare(self):
        return await prepare_pinterest_sheet_recipe(uuid.uuid4(), self.user, self.db)

    async def test_other_accounts_rejected_before_database_or_ai(self):
        self.user.email = "other@gmail.com"
        with self.assertRaises(HTTPException) as caught:
            await self.prepare()
        self.assertEqual(caught.exception.status_code, 403)
        self.db.get.assert_not_awaited()

    async def test_project_access_required(self):
        self.access_mock.side_effect = HTTPException(403, "No access")
        with self.assertRaises(HTTPException) as caught:
            await self.prepare()
        self.assertEqual(caught.exception.status_code, 403)
        self.db.commit.assert_not_awaited()

    async def test_all_midjourney_images_and_existing_metadata_exported(self):
        self.user.email = " KHALIL@GMAIL.COM "
        with patch("app.services.credentials_loader.load_credentials_for_job", new_callable=AsyncMock) as credentials:
            rows = await self.prepare()
        credentials.assert_not_awaited()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], dict(title="Soup", image_url="https://cdn.example.com/one.jpg",
            description="Cozy soup.", tags="soup, dinner", article_link="https://example.com/soup",
            status="published", board="Dinner"))
        self.db.commit.assert_not_awaited()

    async def test_missing_metadata_generated_and_saved(self):
        self.recipe.pin_description = None
        self.recipe.pin_tags = " "
        with patch("app.services.credentials_loader.load_credentials_for_job", AsyncMock(return_value={"openai": "test-key"})), \
             patch("app.services.openai_service.generate_pinterest_pin_description", return_value="AI description") as description, \
             patch("app.services.openai_service.generate_pinterest_pin_tags", return_value="AI tags") as tags:
            rows = await self.prepare()
        description.assert_called_once_with("Soup article", "test-key", {})
        tags.assert_called_once_with("Soup article", "test-key", {})
        self.assertEqual(rows[0]["description"], "AI description")
        self.assertEqual(self.recipe.pin_tags, "AI tags")
        self.db.commit.assert_awaited_once()

    async def test_missing_key_is_actionable(self):
        self.recipe.pin_description = None
        with patch("app.services.credentials_loader.load_credentials_for_job", AsyncMock(return_value={})):
            with self.assertRaises(HTTPException) as caught:
                await self.prepare()
        self.assertEqual(caught.exception.status_code, 400)
        self.db.commit.assert_not_awaited()

    async def test_ai_failure_does_not_save_partial_metadata_or_leak_errors(self):
        self.recipe.pin_description = self.recipe.pin_tags = None
        with patch("app.services.credentials_loader.load_credentials_for_job", AsyncMock(return_value={"openai": "test-key"})), \
             patch("app.services.openai_service.generate_pinterest_pin_description", return_value="AI description"), \
             patch("app.services.openai_service.generate_pinterest_pin_tags", side_effect=RuntimeError("secret")):
            with self.assertRaises(HTTPException) as caught:
                await self.prepare()
        self.assertEqual(caught.exception.status_code, 502)
        self.assertNotIn("secret", caught.exception.detail)
        self.assertIsNone(self.recipe.pin_description)
        self.db.commit.assert_not_awaited()

    async def test_original_images_are_never_used_as_midjourney_fallback(self):
        self.recipe.generated_images = None
        self.recipe.image_url = "https://example.com/original.jpg"
        with self.assertRaises(HTTPException) as caught:
            await self.prepare()
        self.assertEqual(caught.exception.status_code, 422)

    def test_invalid_images_and_duplicates_filtered(self):
        self.assertEqual(generated_image_urls('{"url":"https://example.com/a.jpg"}'), [])
        self.assertEqual(generated_image_urls("not json"), [])
        self.assertEqual(generated_image_urls('[null, 1, "data:image/png;base64,foo", "javascript:alert(1)", "https://example.com/a.jpg", "https://example.com/a.jpg"]'), ["https://example.com/a.jpg"])
