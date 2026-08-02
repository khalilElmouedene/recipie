from __future__ import annotations

import unittest
import uuid
from unittest.mock import patch

from app.services.facebook_logs import write_facebook_log


class _LogSession:
    def __init__(self):
        self.entries = []
        self.commits = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def add(self, entry):
        self.entries.append(entry)

    async def commit(self):
        self.commits += 1


class FacebookGenerationLogTests(unittest.IsolatedAsyncioTestCase):
    async def test_log_is_written_to_the_selected_project_and_content(self):
        project_id = uuid.uuid4()
        content_id = uuid.uuid4()
        session = _LogSession()

        with patch("app.services.facebook_logs.SessionLocal", return_value=session):
            await write_facebook_log(
                project_id,
                "Video validated.",
                content_id=content_id,
                level="success",
                stage="video",
            )

        self.assertEqual(session.commits, 1)
        self.assertEqual(len(session.entries), 1)
        entry = session.entries[0]
        self.assertEqual(entry.project_id, project_id)
        self.assertEqual(entry.content_id, content_id)
        self.assertEqual(entry.level, "success")
        self.assertEqual(entry.stage, "video")


if __name__ == "__main__":
    unittest.main()
