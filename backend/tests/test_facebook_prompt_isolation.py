from __future__ import annotations

import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.db_models import ProjectMemberRole
from app.models import PromptsUpdate
from app.routes import settings as settings_routes


class _PromptResult:
    def scalar_one_or_none(self):
        return None

    def scalars(self):
        return _PromptScalars()


class _PromptScalars:
    def all(self):
        return []


class _PromptSession:
    def __init__(self):
        self.added = []
        self.commits = 0

    async def execute(self, _statement):
        return _PromptResult()

    def add(self, value):
        self.added.append(value)

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


if __name__ == "__main__":
    unittest.main()
