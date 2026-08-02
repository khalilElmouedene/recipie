from __future__ import annotations

import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.db_models import ProjectMemberRole
from app.models import PromptsUpdate
from app.routes import settings as settings_routes


class _PromptResult:
    def __init__(self, values=None):
        self._values = list(values or [])

    def scalar_one_or_none(self):
        return None

    def scalars(self):
        return _PromptScalars(self._values)


class _PromptScalars:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


class _PromptSession:
    def __init__(self, rows=None):
        self.added = []
        self.deleted = []
        self.commits = 0
        self.rows = list(rows or [])

    async def execute(self, _statement):
        return _PromptResult(self.rows)

    def add(self, value):
        self.added.append(value)

    async def delete(self, value):
        self.deleted.append(value)

    async def commit(self):
        self.commits += 1


class FacebookPromptIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_prompt_override_is_stored_on_selected_project_only(self):
        selected_project_id = uuid.uuid4()
        owner_id = uuid.uuid4()
        user = SimpleNamespace(id=owner_id)
        db = _PromptSession()

        with patch.object(
            settings_routes,
            "check_project_access",
            new=AsyncMock(return_value=ProjectMemberRole.admin),
        ) as access_check:
            await settings_routes.update_prompts(
                PromptsUpdate(prompts={"article": "Project-specific article prompt"}),
                user,
                db,
                selected_project_id,
            )

        access_check.assert_awaited_once_with(
            selected_project_id,
            user,
            db,
            require_roles=[ProjectMemberRole.admin],
        )
        self.assertEqual(len(db.added), 1)
        self.assertEqual(db.added[0].owner_id, owner_id)
        self.assertEqual(db.added[0].project_id, selected_project_id)
        self.assertEqual(db.added[0].key, "article")
        self.assertEqual(db.commits, 1)

    async def test_reset_selected_video_prompts_preserves_other_project_prompts(self):
        selected_project_id = uuid.uuid4()
        owner_id = uuid.uuid4()
        user = SimpleNamespace(id=owner_id)
        video_script = SimpleNamespace(key="facebook_video_script")
        recipe_card = SimpleNamespace(key="facebook_recipe_card")
        article = SimpleNamespace(key="article")
        db = _PromptSession(rows=[video_script, recipe_card, article])

        with patch.object(
            settings_routes,
            "check_project_access",
            new=AsyncMock(return_value=ProjectMemberRole.admin),
        ) as access_check:
            await settings_routes.reset_prompts(
                user,
                db,
                selected_project_id,
                keys=["facebook_video_script", "facebook_recipe_card"],
            )

        access_check.assert_awaited_once_with(
            selected_project_id,
            user,
            db,
            require_roles=[ProjectMemberRole.admin],
        )
        self.assertEqual(db.deleted, [video_script, recipe_card])
        self.assertNotIn(article, db.deleted)
        self.assertEqual(db.commits, 1)


if __name__ == "__main__":
    unittest.main()
