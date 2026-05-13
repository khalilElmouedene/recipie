from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


class PublishImageModeConfigTests(unittest.TestCase):
    def test_single_recipe_publish_endpoint_passes_site_image_mode(self) -> None:
        text = (REPO_ROOT / "backend/app/routes/recipes.py").read_text(encoding="utf-8")
        start = text.index("async def publish_recipe_article")
        end = text.index("recipe_dict = {", start)
        endpoint_setup = text[start:end]

        self.assertIn('"image_mode"', endpoint_setup)
        self.assertIn('"skip_inline_top_image"', endpoint_setup)
        self.assertIn("site_obj", endpoint_setup)


if __name__ == "__main__":
    unittest.main()
