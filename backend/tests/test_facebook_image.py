from __future__ import annotations

import base64
import tempfile
import unittest
import uuid
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from PIL import Image

from app.services.facebook_image import FacebookImagePostGenerator, _render_prompt


def _png_base64() -> str:
    output = BytesIO()
    Image.new("RGB", (32, 48), "#1877f2").save(output, format="PNG")
    return base64.b64encode(output.getvalue()).decode()


class FacebookImagePromptTests(unittest.TestCase):
    def test_prompt_assigns_template_and_source_roles_and_expands_recipe_fields(self):
        prompt = _render_prompt(
            "Create {recipe_title}. Include {recipe_post}.",
            "Garlic Sauce",
            "Garlic Sauce\nIngredients...",
        )

        self.assertIn("FIRST image is the design template", prompt)
        self.assertIn("SECOND image is the source food image", prompt)
        self.assertIn("Create Garlic Sauce", prompt)
        self.assertIn("Garlic Sauce\nIngredients...", prompt)


class FacebookImageGenerationTests(unittest.TestCase):
    def test_generator_sends_two_images_with_page_model_quality_and_prompt(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            root = Path(directory)

            def prepare(_url: str, destination: Path) -> None:
                Image.new("RGB", (64, 64), "white").save(destination, format="PNG")

            edit = MagicMock(
                return_value=SimpleNamespace(
                    data=[SimpleNamespace(b64_json=_png_base64())]
                )
            )
            client = SimpleNamespace(images=SimpleNamespace(edit=edit))
            content_id = uuid.uuid4()
            delivery_id = uuid.uuid4()

            with (
                patch("app.services.facebook_image.FACEBOOK_UPLOADS", root),
                patch("app.services.facebook_image._copy_or_download_image", side_effect=prepare),
                patch("app.services.facebook_image.OpenAI", return_value=client),
            ):
                url = FacebookImagePostGenerator().generate(
                    content_id=content_id,
                    delivery_id=delivery_id,
                    template_image_url="https://example.com/template.png",
                    source_image_url="https://example.com/source.png",
                    recipe_post="Garlic Sauce\nIngredients...",
                    recipe_title="Garlic Sauce",
                    prompt="Keep text readable: {recipe_title}",
                    model="gpt-image-2",
                    quality="high",
                    openai_api_key="test-key",
                )

            kwargs = edit.call_args.kwargs
            self.assertEqual(kwargs["model"], "gpt-image-2")
            self.assertEqual(kwargs["quality"], "high")
            self.assertEqual(kwargs["size"], "1024x1536")
            self.assertEqual(len(kwargs["image"]), 2)
            self.assertIn("Garlic Sauce", kwargs["prompt"])
            self.assertTrue((root / str(content_id) / f"image-post-{delivery_id}.png").is_file())
            self.assertIn(f"/uploads/facebook/{content_id}/image-post-{delivery_id}.png", url)


if __name__ == "__main__":
    unittest.main()
