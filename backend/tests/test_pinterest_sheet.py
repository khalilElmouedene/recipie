from __future__ import annotations

import os
import asyncio
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("JWT_SECRET_KEY", "pinterest-sheet-test-" * 4)
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())

from fastapi import HTTPException
import httpx
from openai import APIStatusError, APITimeoutError
from app.db_models import RecipeStatus
from app.routes.recipes import prepare_pinterest_sheet_recipe
from app.services.pinterest_sheet import (
    generated_image_urls, generate_sheet_metadata, render_sheet_prompt, SheetMetadataError,
)


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
             patch("app.services.pinterest_sheet.generate_sheet_metadata", AsyncMock(return_value=("AI description", "AI tags"))) as metadata:
            rows = await self.prepare()
        metadata.assert_awaited_once_with("Soup article", "test-key", {}, None, " ")
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
             patch("app.services.pinterest_sheet.generate_sheet_metadata", AsyncMock(side_effect=RuntimeError("secret"))):
            with self.assertRaises(HTTPException) as caught:
                await self.prepare()
        self.assertEqual(caught.exception.status_code, 502)
        self.assertNotIn("secret", caught.exception.detail)
        self.assertIsNone(self.recipe.pin_description)
        self.db.commit.assert_not_awaited()

    async def test_provider_errors_are_actionable_and_do_not_expose_secrets(self):
        request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
        cases = [(APITimeoutError(request=request), 504, "too long"),
                 (TimeoutError(), 504, "too long")]
        for provider_status, app_status, message in [(401, 400, "API key"), (403, 400, "permissions"),
                (429, 429, "billing"), (400, 422, "prompts"), (500, 502, "try again")]:
            response = httpx.Response(provider_status, request=request)
            cases.append((APIStatusError("secret", response=response, body=None), app_status, message))
        for error, status, message in cases:
            with self.subTest(error=type(error).__name__, status=status):
                self.db.get.side_effect = [self.recipe, self.site, None]
                self.recipe.pin_description = None
                with patch("app.services.credentials_loader.load_credentials_for_job", AsyncMock(return_value={"openai": "test-key"})), \
                     patch("app.services.pinterest_sheet.generate_sheet_metadata", AsyncMock(side_effect=error)):
                    with self.assertRaises(HTTPException) as caught:
                        await self.prepare()
                self.assertEqual(caught.exception.status_code, status)
                self.assertIn(message, caught.exception.detail)
                self.assertNotIn("secret", caught.exception.detail)
                self.db.commit.assert_not_awaited()

    async def test_async_generation_runs_both_calls_together_without_retries(self):
        client = AsyncMock()
        both_started = asyncio.Event()
        started = []
        async def complete(**kwargs):
            started.append(kwargs)
            if len(started) == 2:
                both_started.set()
            await asyncio.wait_for(both_started.wait(), timeout=1)
            return SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop",
                message=SimpleNamespace(content="Generated text"))])
        client.chat.completions.create.side_effect = complete
        client.__aenter__.return_value = client
        with patch("app.services.pinterest_sheet.AsyncOpenAI", return_value=client) as constructor:
            result = await generate_sheet_metadata("Soup", "test-key", {}, None, None)
        constructor.assert_called_once_with(api_key="test-key", timeout=20.0, max_retries=0)
        self.assertEqual(result, ("Generated text", "Generated text"))
        self.assertEqual(len(started), 2)
        client.__aexit__.assert_awaited_once()

    async def test_deadline_cancels_outstanding_ai_calls(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        cancelled = []
        async def slow(**kwargs):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.append(True)
        client.chat.completions.create.side_effect = slow
        with patch("app.services.pinterest_sheet.AsyncOpenAI", return_value=client), \
             patch("app.services.pinterest_sheet.SHEET_AI_TIMEOUT_SECONDS", 0.02):
            with self.assertRaises(TimeoutError):
                await generate_sheet_metadata("Soup", "test-key", {}, None, None)
        self.assertEqual(len(cancelled), 2)
        client.__aexit__.assert_awaited_once()

    def test_saved_prompt_json_braces_and_unknown_placeholders_are_literal(self):
        template = 'Use this example: {"description": "text", "tags": ["soup"]}. {article} {custom_note}'
        self.assertEqual(render_sheet_prompt(template, 'Soup {title}'),
            'Use this example: {"description": "text", "tags": ["soup"]}. Soup {title} {custom_note}')

    def test_saved_prompt_aliases_and_missing_source_placeholder(self):
        for alias in ("article", "recipe_title", "recipe_name", "title", "recipe_text", "new_recipe", "full_recipe", "content"):
            with self.subTest(alias=alias):
                self.assertEqual(render_sheet_prompt("Write about {" + alias + "}", "Soup"), "Write about Soup")
        for template in ('Write tags.', 'Example: {"tags": []}', 'Write {unknown}', 'Literal { braces', '{{article}}'):
            with self.subTest(template=template):
                self.assertEqual(render_sheet_prompt(template, "Soup"), template + "\n\nSource article or recipe:\nSoup")

    async def test_custom_json_prompt_reaches_openai_and_preserves_existing_tags(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(
            finish_reason="stop", message=SimpleNamespace(content="Cozy soup description"))])
        prompts = {"pinterest_description": 'Example: {"description": "sample"}. Source: {new_recipe}'}
        with patch("app.services.pinterest_sheet.AsyncOpenAI", return_value=client):
            result = await generate_sheet_metadata("Soup", "test-key", prompts, None, "existing tags")
        self.assertEqual(result, ("Cozy soup description", "existing tags"))
        client.chat.completions.create.assert_awaited_once()
        self.assertEqual(client.chat.completions.create.call_args.kwargs["messages"][0]["content"],
            'Example: {"description": "sample"}. Source: Soup')

    async def test_empty_incomplete_and_refused_responses_identify_the_field(self):
        cases = [(SimpleNamespace(choices=[]), "no result"),
                 (SimpleNamespace(choices=[SimpleNamespace(finish_reason="length")]), "cut off"),
                 (SimpleNamespace(choices=[SimpleNamespace(finish_reason="content_filter")]), "declined"),
                 (SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=None))]), "empty"),
                 (SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content="", refusal="private text"))]), "declined")]
        for response, expected in cases:
            with self.subTest(reason=expected):
                client = AsyncMock()
                client.__aenter__.return_value = client
                client.chat.completions.create.return_value = response
                with patch("app.services.pinterest_sheet.AsyncOpenAI", return_value=client):
                    with self.assertRaises(SheetMetadataError) as caught:
                        await generate_sheet_metadata("Soup", "test-key", {}, "existing description", None)
                self.assertIn("tags", str(caught.exception))
                self.assertIn(expected, str(caught.exception))
                self.assertNotIn("private text", str(caught.exception))

    async def test_field_specific_error_returned_without_saving(self):
        self.recipe.pin_tags = None
        with patch("app.services.credentials_loader.load_credentials_for_job", AsyncMock(return_value={"openai": "test-key"})), \
             patch("app.services.pinterest_sheet.generate_sheet_metadata", AsyncMock(side_effect=SheetMetadataError("OpenAI returned empty Pinterest tags. Please try again."))):
            with self.assertRaises(HTTPException) as caught:
                await self.prepare()
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(caught.exception.detail, "OpenAI returned empty Pinterest tags. Please try again.")
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
