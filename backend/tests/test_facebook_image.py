from __future__ import annotations

import base64
import tempfile
import unittest
import uuid
import asyncio
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from PIL import Image

from app.services.facebook_image import FacebookImagePostGenerator, _render_prompt
from app.services.facebook_generation import FacebookGenerationManager, _GenerationContext
from app.services.facebook_recipe import FacebookRewrittenRecipe


def _png_base64() -> str:
    output = BytesIO()
    Image.new("RGB", (32, 48), "#1877f2").save(output, format="PNG")
    return base64.b64encode(output.getvalue()).decode()


class FacebookImagePromptTests(unittest.TestCase):
    def test_prompt_assigns_template_and_source_roles_and_expands_recipe_fields(self):
        prompt = _render_prompt(
            "Create {recipe_title}. Include {ingredient_recipe}. Full: {recipe_post}.",
            "Garlic Sauce",
            "Garlic Sauce\nIngredients...",
            "- 2 cloves garlic\n- 1 cup yogurt",
        )

        self.assertIn("FIRST image is the design template", prompt)
        self.assertIn("SECOND image is the source food image", prompt)
        self.assertIn("Create Garlic Sauce", prompt)
        self.assertIn("Garlic Sauce\nIngredients...", prompt)
        self.assertIn("- 2 cloves garlic", prompt)


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
                    ingredient_recipe="- 2 cloves garlic\n- 1 cup yogurt",
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


class FacebookImageArticleTests(unittest.IsolatedAsyncioTestCase):
    async def test_article_uses_source_image_while_facebook_keeps_generated_image(self):
        manager = FacebookGenerationManager()
        project_id = uuid.uuid4()
        content_id = uuid.uuid4()
        delivery_id = uuid.uuid4()
        recipe_id = uuid.uuid4()
        source_image_url = "https://example.com/source-food.jpg"
        generated_image_url = "https://example.com/generated-facebook-card.png"
        context = _GenerationContext(
            facebook_project_id=project_id,
            content_project_id=uuid.uuid4(),
            site_id=uuid.uuid4(),
            site_domain="https://recipes.example.com",
            pinterest_url="",
            generate_recipe_json=True,
            credentials={"openai": "test-key"},
            prompts={},
            video_format="9:16",
            video_intro_seconds=5,
            video_fps=30,
            video_bitrate_kbps=5000,
            post_type="image",
            recipe_rewrite_prompt="Rewrite this recipe clearly: {recipe_post}",
        )
        payload = {
            "id": str(content_id),
            "post_type": "image",
            "title": "Garlic Sauce",
            "template_image_url": "https://example.com/template.png",
            "source_image_url": source_image_url,
            "recipe_post": "Garlic Sauce\nIngredients...",
            "generate_article": True,
            "deliveries": [
                {
                    "id": str(delivery_id),
                    "page_name": "Recipe Page",
                    "recipe_card_prompt": "Create a readable card",
                    "recipe_card_model": "gpt-image-2",
                    "recipe_card_quality": "high",
                }
            ],
        }
        manager._load_context = AsyncMock(return_value=context)
        manager._load_content_payloads = AsyncMock(return_value=[payload])
        manager._store_delivery_image = AsyncMock()
        manager._store_rewritten_recipe = AsyncMock()
        manager._prepare_image_recipe = AsyncMock(return_value=recipe_id)
        manager._complete = AsyncMock()
        manager._fail = AsyncMock()
        manager._image.generate = MagicMock(return_value=generated_image_url)

        with (
            patch(
                "app.services.facebook_generation.generate_for_recipe",
                return_value={"generated_article": "<p>Article</p>"},
            ) as generate_article,
            patch(
                "app.services.facebook_generation.rewrite_facebook_recipe_post",
                return_value=FacebookRewrittenRecipe(
                    recipe_title="Rewritten Garlic Sauce",
                    recipe_post="Rewritten Garlic Sauce\nIngredients\n- Garlic\n- Yogurt\n\nInstructions\n1. Blend.",
                    ingredient_recipe="- Garlic\n- Yogurt",
                ),
            ) as rewrite_recipe,
            patch(
                "app.services.facebook_generation.write_facebook_log",
                new=AsyncMock(),
            ),
        ):
            await manager.start_batch(
                facebook_project_id=project_id,
                content_ids=[content_id],
                created_by=uuid.uuid4(),
            )
            for _ in range(200):
                if not manager.is_running(content_id):
                    break
                await asyncio.sleep(0.01)

        self.assertFalse(manager.is_running(content_id))
        manager._store_delivery_image.assert_awaited_once_with(
            content_id, delivery_id, generated_image_url
        )
        rewrite_recipe.assert_called_once()
        manager._store_rewritten_recipe.assert_awaited_once_with(
            content_id,
            recipe_title="Rewritten Garlic Sauce",
            rewritten_recipe_post="Rewritten Garlic Sauce\nIngredients\n- Garlic\n- Yogurt\n\nInstructions\n1. Blend.",
            ingredient_recipe="- Garlic\n- Yogurt",
        )
        image_kwargs = manager._image.generate.call_args.kwargs
        self.assertEqual(image_kwargs["recipe_title"], "Rewritten Garlic Sauce")
        self.assertEqual(image_kwargs["ingredient_recipe"], "- Garlic\n- Yogurt")
        self.assertEqual(
            manager._prepare_image_recipe.await_args.kwargs["article_image_url"],
            source_image_url,
        )
        self.assertEqual(generate_article.call_args.kwargs["image_url"], source_image_url)
        self.assertEqual(
            generate_article.call_args.kwargs["recipe_text"],
            "Rewritten Garlic Sauce\nIngredients\n- Garlic\n- Yogurt\n\nInstructions\n1. Blend.",
        )
        generated_result = manager._complete.await_args.args[2]
        self.assertEqual(
            generated_result["generated_images"],
            f'["{source_image_url}"]',
        )


if __name__ == "__main__":
    unittest.main()
