"""SEO editing/sync permissions and inherited prompt resolution, with no live I/O."""
from __future__ import annotations

import os
import sys
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

os.environ.setdefault("APP_ENV", "development")
# Isolated test keys; never used against a production database or site.
os.environ.setdefault("ENCRYPTION_KEY", "MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
from app.models import RecipeUpdate
from app.routes import recipes, settings
from app.services import wordpress


class SeoApiTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.recipe_id = uuid.uuid4()
        self.recipe = SimpleNamespace(id=self.recipe_id, site_id=uuid.uuid4(), wp_post_id="123",
            focus_keyword="Pumpkin Cookies", seo_title="Pumpkin Cookies Recipe",
            meta_description="Make pumpkin cookies with simple ingredients.")
        self.site = SimpleNamespace(project_id=uuid.uuid4(), wp_url="https://example.com/xmlrpc.php")
        self.user = SimpleNamespace(id=uuid.uuid4())
        self.db = AsyncMock()
        self.db.get.side_effect = [self.recipe, self.site]

    async def test_sync_uses_existing_id_and_checks_project_access(self):
        with patch.object(recipes, "check_project_access", new_callable=AsyncMock) as access, \
                patch.object(recipes, "get_random_wp_credentials", return_value=("test", "test-password")), \
                patch.object(wordpress, "set_rank_math_meta", return_value={"status": "verified", "message": ""}) as write:
            result = await recipes.sync_recipe_seo(self.recipe_id, self.user, self.db)
        access.assert_awaited_once_with(self.site.project_id, self.user, self.db)
        self.assertEqual(write.call_args.args[0], "123")
        self.assertEqual(write.call_args.args[1], "pumpkin cookies")
        self.assertEqual(result["status"], "verified")
        self.db.commit.assert_not_called()

    async def test_unauthorized_sync_never_writes_wordpress(self):
        with patch.object(recipes, "check_project_access", new_callable=AsyncMock,
                          side_effect=HTTPException(403, "Forbidden")), patch.object(wordpress, "set_rank_math_meta") as write:
            with self.assertRaises(HTTPException) as raised:
                await recipes.sync_recipe_seo(self.recipe_id, self.user, self.db)
        self.assertEqual(raised.exception.status_code, 403)
        write.assert_not_called()

    async def test_unpublished_or_inconsistent_seo_never_writes(self):
        for change, status in (({"wp_post_id": ""}, 400), ({"focus_keyword": ""}, 422),
                               ({"seo_title": "Another dish"}, 422)):
            with self.subTest(change=change):
                self.setUp()
                for key, value in change.items():
                    setattr(self.recipe, key, value)
                with patch.object(recipes, "check_project_access", new_callable=AsyncMock), patch.object(wordpress, "set_rank_math_meta") as write:
                    with self.assertRaises(HTTPException) as raised:
                        await recipes.sync_recipe_seo(self.recipe_id, self.user, self.db)
                self.assertEqual(raised.exception.status_code, status)
                write.assert_not_called()

    async def test_keyword_and_description_can_be_edited_and_sanitized(self):
        result = Mock()
        result.scalar_one_or_none.side_effect = [self.recipe, self.site]
        result.scalar_one.return_value = self.recipe
        self.db.execute.return_value = result
        self.db.get.side_effect = None
        body = RecipeUpdate(focus_keyword="Soft Pumpkin Cookies", meta_description="<b>Make soft pumpkin cookies.</b>")
        with patch.object(recipes, "check_project_access", new_callable=AsyncMock):
            await recipes.update_recipe(self.recipe_id, body, self.user, self.db)
        self.assertEqual(self.recipe.focus_keyword, "soft pumpkin cookies")
        self.assertEqual(self.recipe.meta_description, "Make soft pumpkin cookies.")
        self.db.commit.assert_awaited_once()

    async def test_settings_matches_owner_fallback_then_project_override(self):
        def rows(value):
            result = Mock()
            result.scalars.return_value.all.return_value = value
            return result
        project = Mock()
        project.scalar_one_or_none.return_value = SimpleNamespace(owner_id=self.user.id)
        fallback = [SimpleNamespace(key="article", value="Inherited article", description="old"),
                    SimpleNamespace(key="focus_keyword", value="Inherited keyword", description="old")]
        override = [SimpleNamespace(key="article", value="Project article", description="old")]
        self.db.execute.side_effect = [project, rows(fallback), rows(override)]
        with patch.object(settings, "check_project_access", new_callable=AsyncMock):
            result = await settings.list_prompts(self.user, self.db, self.site.project_id)
        values = {item.key: item for item in result}
        self.assertEqual(values["article"].value, "Project article")
        self.assertEqual(values["focus_keyword"].value, "Inherited keyword")
        self.assertIn("focus_keyword", values["article"].description)


if __name__ == "__main__":
    unittest.main()
