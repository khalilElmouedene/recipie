from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


os.environ.setdefault("APP_ENV", "development")

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services import publisher  # noqa: E402


class PublisherPinEmbedTests(unittest.TestCase):
    def setUp(self) -> None:
        self.site_config = {
            "wp_url": "https://example.com/xmlrpc.php",
            "wp_username": "author",
            "wp_password": "secret",
            "domain": "https://example.com",
        }
        self.base_recipe = {
            "id": "recipe-1",
            "recipe_text": "Honey Lavender Latte Cookies",
            "generated_json": "",
            "focus_keyword": "",
            "meta_description": "",
            "category": "",
            "image_url": "https://images.example.com/featured.jpg",
            "generated_images": "",
            "pin_design_image": "https://images.example.com/pin.png",
            "seo_title": "",
            "wp_tags": "",
        }

    def _publish(self, recipe: dict):
        posted_payloads: list[dict] = []

        class FakeSession:
            def post(self, _url, json=None, **_kwargs):
                response = Mock()
                response.raise_for_status = Mock()
                response.json.return_value = {"id": 123, "link": "https://example.com/post/"}
                posted_payloads.append(json or {})
                return response

        logs: list[str] = []
        upload_image_results = [
            (10, "https://wp.example.com/featured.webp"),
            (11, "https://wp.example.com/wp-published-pin.webp"),
        ]

        with (
            patch.object(publisher, "_random_delay", return_value=None),
            patch.object(publisher, "upload_image", side_effect=upload_image_results) as upload_image_mock,
            patch.object(publisher, "upload_pin_embed_images", return_value=None),
            patch.object(publisher, "validate_recipe_json", return_value=None),
            patch.object(publisher, "set_rank_math_meta", return_value=None),
            patch.object(publisher, "_wp_session", return_value=FakeSession()),
        ):
            result = publisher.publish_recipe(recipe, self.site_config, log=logs.append)

        self.assertEqual(result["wp_post_id"], "123")
        self.assertEqual(len(posted_payloads), 1)
        return posted_payloads[0], upload_image_mock, logs

    def test_existing_app_pin_embed_skips_second_pin_append(self) -> None:
        recipe = {
            **self.base_recipe,
            "generated_article": """
                <h1>Honey Lavender Latte Cookies</h1>
                <p>Don't forget to follow us on Pinterest.</p>
                <!-- wp:html -->
                <figure class="recipe-generator-pin-embed" data-recipe-generator-pin-embed="1" data-pin-display="optional">
                    <img src="https://cdn.example.com/embedded-pin.webp" alt="Recipe pin" />
                </figure>
                <!-- /wp:html -->
            """,
        }

        payload, upload_image_mock, logs = self._publish(recipe)
        content = payload["content"]

        self.assertEqual(upload_image_mock.call_count, 1)
        self.assertEqual(content.count("data-recipe-generator-pin-embed"), 1)
        self.assertEqual(content.count("<img"), 1)
        self.assertNotIn("wp-published-pin.webp", content)
        self.assertTrue(any("skipping duplicate append" in msg for msg in logs))

    def test_pin_image_still_appends_when_article_has_no_app_embed(self) -> None:
        recipe = {
            **self.base_recipe,
            "generated_article": """
                <h1>Honey Lavender Latte Cookies</h1>
                <p>Don't forget to follow us on Pinterest.</p>
            """,
        }

        payload, upload_image_mock, _logs = self._publish(recipe)
        content = payload["content"]

        self.assertEqual(upload_image_mock.call_count, 2)
        self.assertIn("wp-published-pin.webp", content)
        self.assertEqual(content.count("<img"), 1)

    def test_featured_only_image_mode_does_not_inject_top_article_image(self) -> None:
        recipe = {
            **self.base_recipe,
            "pin_design_image": "",
            "generated_article": """
                <h1>Honey Lavender Latte Cookies</h1>
                <p>Don't forget to follow us on Pinterest.</p>
            """,
        }
        self.site_config["image_mode"] = "featured_only"

        payload, upload_image_mock, _logs = self._publish(recipe)

        self.assertEqual(upload_image_mock.call_count, 1)
        self.assertEqual(payload["featured_media"], 10)
        self.assertNotIn("<img", payload["content"])

    def test_featured_and_top_image_mode_injects_top_article_image(self) -> None:
        recipe = {
            **self.base_recipe,
            "pin_design_image": "",
            "generated_article": """
                <h1>Honey Lavender Latte Cookies</h1>
                <p>Don't forget to follow us on Pinterest.</p>
            """,
        }
        self.site_config["image_mode"] = "featured_and_top"

        payload, upload_image_mock, _logs = self._publish(recipe)

        self.assertEqual(upload_image_mock.call_count, 1)
        self.assertEqual(payload["featured_media"], 10)
        self.assertIn('src="https://wp.example.com/featured.webp"', payload["content"])


if __name__ == "__main__":
    unittest.main()
