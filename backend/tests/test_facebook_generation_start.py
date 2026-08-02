from __future__ import annotations

import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.db_models import (
    FacebookContent,
    FacebookDelivery,
    FacebookDeliveryStatus,
    FacebookGenerationLog,
)
from app.routes.facebook import FacebookGenerationStart, start_facebook_generation


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

    def __iter__(self):
        return iter(self._values)


class _GenerationSession:
    def __init__(self, results):
        self._results = iter(results)
        self.added = []
        self.statements = []
        self.commits = 0

    async def execute(self, statement):
        self.statements.append(statement)
        return next(self._results)

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        for item in self.added:
            if isinstance(item, FacebookContent) and item.id is None:
                item.id = uuid.uuid4()

    async def commit(self):
        self.commits += 1


class FacebookGenerationStartTests(unittest.IsolatedAsyncioTestCase):
    async def test_batch_generates_content_once_and_creates_one_delivery_per_page(self):
        project_id = uuid.uuid4()
        content_project_id = uuid.uuid4()
        owner_id = uuid.uuid4()
        page_ids = [uuid.uuid4(), uuid.uuid4()]
        row_ids = [uuid.uuid4(), uuid.uuid4()]
        project = SimpleNamespace(
            id=project_id,
            owner_id=owner_id,
            content_project_id=content_project_id,
            name="Facebook recipes",
            generation_paused=False,
        )
        site = SimpleNamespace(id=uuid.uuid4())
        pages = [
            SimpleNamespace(id=page_ids[0], created_at=1),
            SimpleNamespace(id=page_ids[1], created_at=2),
        ]
        spy_rows = [
            SimpleNamespace(
                id=row_ids[0],
                direct_link="https://example.com/uploads/facebook/one.mp4",
                post_title="Recipe one",
                created_at=1,
            ),
            SimpleNamespace(
                id=row_ids[1],
                direct_link="https://example.com/uploads/facebook/two.mp4",
                post_title="Recipe two",
                created_at=2,
            ),
        ]
        session = _GenerationSession(
            [
                _Result(scalar=project),
                _Result(scalar=0),
                _Result(scalar=site),
                _Result(values=pages),
                _Result(values=spy_rows),
                _Result(),
                _Result(scalar=2),
            ]
        )
        start_batch = AsyncMock()
        send_low_queue_email = AsyncMock()

        with (
            patch(
                "app.routes.facebook.facebook_generation_manager.is_cancelling",
                return_value=False,
            ),
            patch(
                "app.routes.facebook.facebook_generation_manager.start_batch",
                start_batch,
            ),
            patch(
                "app.routes.facebook.load_credentials_for_job",
                new=AsyncMock(return_value={"openai": "project-openai-key"}),
            ),
            patch(
                "app.routes.facebook.send_facebook_spy_sheet_low_email",
                send_low_queue_email,
            ),
        ):
            result = await start_facebook_generation(
                project_id,
                FacebookGenerationStart(
                    row_ids=row_ids,
                    schedule=False,
                    page_ids=page_ids,
                ),
                SimpleNamespace(
                    id=owner_id,
                    email="owner@example.com",
                    full_name="Project owner",
                ),
                session,
            )

        contents = [item for item in session.added if isinstance(item, FacebookContent)]
        deliveries = [item for item in session.added if isinstance(item, FacebookDelivery)]
        logs = [item for item in session.added if isinstance(item, FacebookGenerationLog)]

        self.assertEqual(len(contents), 2)
        self.assertEqual(len({content.id for content in contents}), 2)
        self.assertEqual([content.title for content in contents], ["Recipe one", "Recipe two"])
        self.assertEqual(len(deliveries), 4)
        self.assertEqual(
            {(delivery.content_id, delivery.page_id) for delivery in deliveries},
            {(content.id, page_id) for content in contents for page_id in page_ids},
        )
        self.assertTrue(
            all(delivery.status == FacebookDeliveryStatus.processing for delivery in deliveries)
        )
        self.assertEqual(len(logs), 2)
        self.assertTrue(
            any("DELETE FROM facebook_spy_rows" in str(statement) for statement in session.statements)
        )
        self.assertEqual(result.content_ids, [content.id for content in contents])
        self.assertEqual(result.removed_rows, 2)
        self.assertEqual(result.remaining_rows, 2)
        self.assertTrue(result.low_queue_email_sent)
        send_low_queue_email.assert_awaited_once_with(
            "owner@example.com",
            "Project owner",
            "Facebook recipes",
            2,
        )
        start_batch.assert_awaited_once_with(
            facebook_project_id=project_id,
            content_ids=[content.id for content in contents],
            created_by=owner_id,
        )
        self.assertEqual(session.commits, 1)


if __name__ == "__main__":
    unittest.main()
