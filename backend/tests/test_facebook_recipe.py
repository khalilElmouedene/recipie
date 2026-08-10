from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.facebook_recipe import rewrite_facebook_recipe_post


class FacebookRecipeRewriteTests(unittest.TestCase):
    def test_rewrite_creates_title_full_recipe_and_only_first_eight_ingredients(self):
        payload = {
            "recipe_title": "Ultimate Grilled Cheese",
            "rewritten_recipe": (
                "Ultimate Grilled Cheese\n\nIngredients\n- Bread\n- Butter\n"
                "- Cheddar\n- Cream cheese\n- Jalapeno\n- Bacon\n- Garlic\n"
                "- Black pepper\n- Salt\n\nInstructions\n1. Grill."
            ),
            "ingredients": [
                "Bread",
                "Butter",
                "Cheddar",
                "Cream cheese",
                "Jalapeno",
                "Bacon",
                "Garlic",
                "Black pepper",
                "Salt",
            ],
        }
        create = MagicMock(
            return_value=SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(content=json.dumps(payload))
                    )
                ]
            )
        )
        client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=create))
        )

        with patch("app.services.facebook_recipe.OpenAI", return_value=client):
            result = rewrite_facebook_recipe_post(
                recipe_post="Original recipe",
                custom_prompt="Rewrite this input: {recipe_post}",
                openai_api_key="test-key",
            )

        self.assertEqual(result.recipe_title, "Ultimate Grilled Cheese")
        self.assertEqual(result.recipe_post, payload["rewritten_recipe"])
        self.assertEqual(
            result.ingredient_recipe.splitlines(),
            [
                "- Bread",
                "- Butter",
                "- Cheddar",
                "- Cream cheese",
                "- Jalapeno",
                "- Bacon",
                "- Garlic",
                "- Black pepper",
            ],
        )
        request_prompt = create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("Rewrite this input: Original recipe", request_prompt)
        self.assertEqual(create.call_args.kwargs["response_format"], {"type": "json_object"})

    def test_rewrite_can_extract_ingredients_from_recipe_when_json_list_is_missing(self):
        payload = {
            "recipe_title": "Garlic Sauce",
            "rewritten_recipe": (
                "Garlic Sauce\n\nIngredients:\n* Yogurt\n* Garlic\n* Lemon juice\n\n"
                "Instructions:\n1. Blend."
            ),
        }
        client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(
                    create=MagicMock(
                        return_value=SimpleNamespace(
                            choices=[
                                SimpleNamespace(
                                    message=SimpleNamespace(content=json.dumps(payload))
                                )
                            ]
                        )
                    )
                )
            )
        )

        with patch("app.services.facebook_recipe.OpenAI", return_value=client):
            result = rewrite_facebook_recipe_post(
                recipe_post="Original",
                custom_prompt="Rewrite clearly",
                openai_api_key="test-key",
            )

        self.assertEqual(
            result.ingredient_recipe,
            "- Yogurt\n- Garlic\n- Lemon juice",
        )


if __name__ == "__main__":
    unittest.main()

