"""Offline regression tests for workspace duplication and article image selection."""
from __future__ import annotations

import asyncio
from contextlib import ExitStack
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import AsyncMock, Mock, patch

from cryptography.fernet import Fernet

os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("ENCRYPTION_KEY", Fernet.generate_key().decode())

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session

from app.crypto import decrypt, encrypt
from app.database import Base
from app.db_models import (
    FacebookContent, FacebookPage, FacebookProject, FacebookSpyRow,
    Project, ProjectCredential, Prompt, Site, User,
)
from app.routes.facebook import (
    FacebookProjectDuplicate, FacebookProjectUpdate, duplicate_facebook_project, update_facebook_project,
)
from app.services import article_generator, facebook_generation, openai_service
from app.services.facebook_generation import FacebookGenerationManager, _GenerationContext


class _AsyncSessionAdapter:
    """Exercise real persistence with SQLite, without requiring an async driver."""
    def __init__(self, session):
        self.session = session

    def add(self, item):
        self.session.add(item)

    async def execute(self, statement):
        return self.session.execute(statement)

    async def flush(self):
        self.session.flush()

    async def commit(self):
        self.session.commit()

    async def refresh(self, item):
        self.session.refresh(item)


class FacebookProjectConfigurationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine, expire_on_commit=False)
        self.db = _AsyncSessionAdapter(self.session)
        self.user = User(email="owner@example.com", full_name="Owner")
        self.session.add(self.user)
        self.session.flush()
        content_project = Project(name="Content", owner_id=self.user.id)
        self.session.add(content_project)
        self.session.flush()
        self.source = FacebookProject(
            owner_id=self.user.id, content_project_id=content_project.id,
            name="Recipes", description="A configured workspace", use_midjourney=False,
            app_id="meta-app", app_secret=encrypt("meta-secret"),
            video_format="4:5", video_fps=60, video_intro_seconds=8,
            video_bitrate_kbps=12000, generation_paused=True,
            recipe_rewrite_prompt="Rewrite this recipe",
        )
        self.session.add(self.source)
        self.session.flush()
        self.page = FacebookPage(
            project_id=self.source.id, facebook_page_id="page-123", name="Food",
            access_token=encrypt("page-token"), tts_voice="alloy",
            recipe_card_prompt="Custom card", recipe_card_quality="high",
            post_header_mode="title_ingredients", publish_start_time="09:00",
            publish_end_time="20:00", interval_minutes=240,
            max_posts_per_day=3, timezone="Europe/Paris",
        )
        self.site = Site(
            project_id=content_project.id, domain="https://example.com",
            wp_url="https://example.com/xmlrpc.php", wp_users_enc='[{"password_enc":"encrypted"}]',
            generate_recipe_json=False, image_mode="featured_only",
        )
        self.credential = ProjectCredential(
            project_id=content_project.id, key_type="openai", encrypted_value=encrypt("api-key"),
        )
        self.prompt = Prompt(
            owner_id=self.user.id, project_id=content_project.id,
            key="article", value="Custom article prompt", description="Custom",
        )
        self.session.add_all([
            self.page, self.site, self.credential, self.prompt,
            FacebookContent(project_id=self.source.id, title="Existing post", source_video_url="video.mp4"),
            FacebookSpyRow(project_id=self.source.id, post_title="Queued recipe", direct_link="video.mp4"),
        ])
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    async def test_duplicate_copies_settings_and_encrypted_connections_without_content(self):
        result = await duplicate_facebook_project(self.source.id, self.user, self.db)
        self.assertNotEqual(result.id, self.source.id)
        self.assertNotEqual(result.content_project_id, self.source.content_project_id)
        self.assertEqual(result.name, "Recipes (copy)")
        self.assertEqual(result.page_count, 1)
        self.assertEqual(result.content_count, 0)
        self.assertTrue(result.has_website)
        self.assertFalse(result.use_midjourney)
        duplicate = self.session.get(FacebookProject, result.id)
        self.assertFalse(duplicate.generation_paused)
        self.assertEqual(decrypt(duplicate.app_secret), "meta-secret")
        for field in ("video_format", "video_fps", "video_intro_seconds", "video_bitrate_kbps", "recipe_rewrite_prompt"):
            self.assertEqual(getattr(duplicate, field), getattr(self.source, field))
        for model, original, project_id in (
            (FacebookPage, self.page, duplicate.id),
            (Site, self.site, duplicate.content_project_id),
            (ProjectCredential, self.credential, duplicate.content_project_id),
            (Prompt, self.prompt, duplicate.content_project_id),
        ):
            cloned = self.session.scalars(select(model).where(model.project_id == project_id)).one()
            self.assertNotEqual(cloned.id, original.id)
            for column in model.__table__.columns:
                if column.name not in {"id", "project_id", "created_at", "updated_at"}:
                    self.assertEqual(getattr(cloned, column.name), getattr(original, column.name))
        self.assertEqual(self.session.scalars(select(FacebookSpyRow).where(FacebookSpyRow.project_id == duplicate.id)).all(), [])
        self.assertEqual(self.session.scalars(select(FacebookContent).where(FacebookContent.project_id == self.source.id)).one().title, "Existing post")
        cloned_site = self.session.scalars(select(Site).where(Site.project_id == duplicate.content_project_id)).one()
        cloned_site.domain = "https://new.example.com"
        self.session.commit()
        self.assertEqual(self.site.domain, "https://example.com")

    async def test_another_user_cannot_duplicate_project(self):
        with self.assertRaises(HTTPException) as raised:
            await duplicate_facebook_project(self.source.id, SimpleNamespace(id=uuid.uuid4()), self.db)
        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(len(self.session.scalars(select(FacebookProject)).all()), 1)

    async def test_duplicate_uses_trimmed_custom_name_for_both_projects(self):
        result = await duplicate_facebook_project(
            self.source.id, self.user, self.db,
            FacebookProjectDuplicate(name="  Weekend Recipes  "),
        )
        self.assertEqual(result.name, "Weekend Recipes")
        self.assertEqual(self.session.get(Project, result.content_project_id).name, "Weekend Recipes - Facebook Content")
        self.assertEqual(self.source.name, "Recipes")

    def test_duplicate_name_rejects_empty_whitespace_and_overlong_values(self):
        for name in ("", "   ", "\t\n", "X" * 256):
            with self.subTest(name=name), self.assertRaises(ValidationError):
                FacebookProjectDuplicate(name=name)

    async def test_image_project_and_maximum_length_name_duplicate(self):
        self.source.name = "X" * 255
        self.source.post_type = "image"
        self.session.commit()
        result = await duplicate_facebook_project(self.source.id, self.user, self.db)
        self.assertEqual(result.post_type, "image")
        self.assertLessEqual(len(result.name), 255)
        self.assertLessEqual(len(self.session.get(Project, result.content_project_id).name), 200)

    async def test_image_choice_persists_and_other_updates_preserve_it(self):
        for enabled in (True, False):
            updated = await update_facebook_project(self.source.id, FacebookProjectUpdate(use_midjourney=enabled), self.user, self.db)
            self.assertEqual(updated.use_midjourney, enabled)
        await update_facebook_project(self.source.id, FacebookProjectUpdate(description="New description"), self.user, self.db)
        self.assertFalse(self.session.get(FacebookProject, self.source.id).use_midjourney)
        with self.assertRaises(ValidationError):
            FacebookProjectUpdate(use_midjourney=None)


class ArticleImageChoiceTests(unittest.TestCase):
    def generate(self, use_midjourney):
        values = {
            "generate_full_recipe": "Soup\nIngredients and instructions", "generate_focus_keyword": "soup",
            "generate_article": "<p>Soup article</p>", "generate_recipe_json": "{}",
            "generate_meta_description": "Soup description", "generate_category": "Soup",
            "generate_seo_title": "Soup recipe", "generate_wp_tags": "soup",
            "generate_pinterest_pin_board": "Soup", "generate_pinterest_pin_title": "Soup",
            "generate_pinterest_pin_description": "Soup", "generate_pinterest_pin_tags": "soup",
        }
        with ExitStack() as stack:
            for key, value in values.items():
                stack.enter_context(patch.object(openai_service, key, return_value=value))
            stack.enter_context(patch.object(article_generator, "get_sitemap_links", return_value=[]))
            mj = stack.enter_context(patch.object(article_generator, "_generate_midjourney_cached_images", return_value=["https://example.com/generated.jpg"]))
            result = article_generator.generate_for_recipe(
                "test-recipe", "Soup", "https://example.com/video-screenshot.jpg", "https://example.com",
                {"openai": "test-key", "discord_auth": "saved-token", "discord_channel": "channel"},
                use_midjourney=use_midjourney, log=lambda _: None,
            )
        self.assertNotIn("error_message", result)
        self.assertEqual(result["generated_article"], "<p>Soup article</p>")
        return result, mj

    def test_disabled_bypasses_midjourney_even_with_saved_credentials(self):
        result, mj = self.generate(False)
        mj.assert_not_called()
        self.assertEqual(json.loads(result["generated_images"]), ["https://example.com/video-screenshot.jpg"])

    def test_enabled_uses_midjourney_images(self):
        result, mj = self.generate(True)
        mj.assert_called_once()
        self.assertEqual(json.loads(result["generated_images"]), ["https://example.com/generated.jpg"])


class FacebookVideoImageChoiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_worker_passes_saved_choice_and_video_screenshot_to_article(self):
        for enabled in (True, False):
            manager = FacebookGenerationManager()
            project_id, content_id, delivery_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
            context = _GenerationContext(
                facebook_project_id=project_id, content_project_id=uuid.uuid4(), site_id=uuid.uuid4(),
                site_domain="https://example.com", pinterest_url="", generate_recipe_json=True,
                credentials={"openai": "key", "discord_auth": "saved-token"}, prompts={"facebook_video_script": "script"},
                video_format="9:16", video_intro_seconds=5, video_fps=30, video_bitrate_kbps=8000,
                post_type="video", recipe_rewrite_prompt="rewrite", use_midjourney=enabled,
            )
            manager._load_context = AsyncMock(return_value=context)
            manager._load_content_payloads = AsyncMock(return_value=[{
                "id": str(content_id), "title": "Soup", "source_url": "source.mp4", "post_type": "video",
                "deliveries": [{"id": str(delivery_id), "page_name": "Food", "tts_voice": "nova", "recipe_card_prompt": "card", "recipe_card_model": "gpt-image-2", "recipe_card_quality": "low"}],
            }])
            manager._video.process = Mock(return_value=SimpleNamespace(screenshot_url="https://example.com/screenshot.jpg", processed_video_url="https://example.com/reel.mp4"))
            manager._store_delivery_video = AsyncMock()
            manager._store_processed_video = AsyncMock(return_value=uuid.uuid4())
            manager._complete = AsyncMock()
            manager._fail = AsyncMock()
            with patch.object(facebook_generation, "generate_for_recipe", return_value={"generated_article": "<p>Soup</p>"}) as generate, patch.object(facebook_generation, "write_facebook_log", new=AsyncMock()):
                await manager.start_batch(facebook_project_id=project_id, content_ids=[content_id], created_by=uuid.uuid4())
                for _ in range(200):
                    if not manager.is_running(content_id):
                        break
                    await asyncio.sleep(0.01)
            manager._fail.assert_not_awaited()
            manager._complete.assert_awaited_once()
            self.assertEqual(generate.call_args.kwargs["use_midjourney"], enabled)
            self.assertEqual(generate.call_args.kwargs["image_url"], "https://example.com/screenshot.jpg")


class OptionalMidjourneyMigrationTests(unittest.TestCase):
    def test_existing_projects_keep_current_behavior_and_upgrade_is_idempotent(self):
        migration_path = Path(__file__).parents[1] / "alembic/versions/add_facebook_optional_midjourney.py"
        spec = importlib.util.spec_from_file_location("optional_midjourney_migration", migration_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        engine = create_engine("sqlite://")
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE facebook_projects (id INTEGER PRIMARY KEY)"))
            conn.execute(text("INSERT INTO facebook_projects (id) VALUES (1)"))
            with Operations.context(MigrationContext.configure(conn)):
                module.upgrade()
                module.upgrade()
            self.assertEqual(conn.execute(text("SELECT use_midjourney FROM facebook_projects")).scalar_one(), 1)
            self.assertIn("use_midjourney", {c["name"] for c in inspect(conn).get_columns("facebook_projects")})
        engine.dispose()


if __name__ == "__main__":
    unittest.main()
