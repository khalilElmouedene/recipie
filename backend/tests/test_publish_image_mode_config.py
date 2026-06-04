from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


class PublishImageModeConfigTests(unittest.TestCase):
    def _assert_builder_uses_image_mode(self, path: str, start_marker: str, end_marker: str) -> None:
        text = (REPO_ROOT / path).read_text(encoding="utf-8")
        start = text.index(start_marker)
        end = text.index(end_marker, start)
        section = text[start:end]

        self.assertIn('"image_mode"', section)
        self.assertIn("featured_and_top", section)

    def test_single_recipe_publish_endpoint_passes_site_image_mode(self) -> None:
        self._assert_builder_uses_image_mode(
            "backend/app/routes/recipes.py",
            "async def publish_recipe_article",
            "recipe_dict = {",
        )

    def test_project_publish_work_builder_passes_site_image_mode(self) -> None:
        self._assert_builder_uses_image_mode(
            "backend/app/routes/projects.py",
            "def _append_work",
            "recipe_dict = {",
        )

    def test_publisher_job_site_config_passes_site_image_mode(self) -> None:
        self._assert_builder_uses_image_mode(
            "backend/app/workers/job_manager.py",
            "def _build_site_config",
            "def stop_job",
        )

    def test_publish_scheduler_passes_site_image_mode(self) -> None:
        self._assert_builder_uses_image_mode(
            "backend/app/services/publish_scheduler.py",
            "def _build_site_config",
            "def _publish_with_user_retry",
        )

    def test_auto_spy_publish_configs_pass_site_image_mode(self) -> None:
        text = (REPO_ROOT / "backend/app/services/auto_spy_job_runner.py").read_text(encoding="utf-8")
        self.assertGreaterEqual(text.count('"image_mode"'), 2)
        self.assertIn("getattr(site_obj, \"image_mode\"", text)


if __name__ == "__main__":
    unittest.main()
