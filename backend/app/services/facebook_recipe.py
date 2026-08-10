from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Callable

from openai import OpenAI


DEFAULT_FACEBOOK_RECIPE_REWRITE_PROMPT = """Rewrite the Recipe Post into a complete, clear, natural recipe for a Facebook audience.

Requirements:
- Preserve the same dish and the important facts from the source.
- Put the recipe title on the first line.
- Include a clear Ingredients section with quantities.
- Include concise step-by-step instructions.
- Use readable plain text without Markdown heading symbols.
- Do not add promotional text, URLs, hashtags, or explanations."""


@dataclass(frozen=True)
class FacebookRewrittenRecipe:
    recipe_title: str
    recipe_post: str
    ingredient_recipe: str


def _clean_title(value: object) -> str:
    title = re.sub(r"^[\s#*_-]+|[\s#*_]+$", "", str(value or "").strip())
    title = re.sub(r"^(?:recipe\s+)?title\s*:\s*", "", title, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", title).strip()[:500]


def _clean_ingredient(value: object) -> str:
    ingredient = re.sub(
        r"^\s*(?:[-*•]+|\d+[.)])\s*",
        "",
        str(value or "").strip(),
    )
    return re.sub(r"\s+", " ", ingredient).strip()


def _ingredients_from_recipe(recipe_post: str) -> list[str]:
    ingredients: list[str] = []
    inside_section = False
    for raw_line in recipe_post.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        normalized = re.sub(r"[^a-z]", "", line.lower())
        if normalized.startswith("ingredients"):
            inside_section = True
            continue
        if inside_section and normalized.startswith(
            ("instructions", "directions", "method", "preparation", "notes", "nutrition")
        ):
            break
        if not inside_section:
            continue
        ingredient = _clean_ingredient(line)
        if ingredient:
            ingredients.append(ingredient)
        if len(ingredients) == 8:
            break
    return ingredients


def _json_payload(raw_response: str) -> dict:
    cleaned = re.sub(
        r"^```(?:json)?\s*|\s*```$",
        "",
        str(raw_response or "").strip(),
        flags=re.IGNORECASE,
    )
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError("OpenAI did not return a valid rewritten recipe.") from exc
    if not isinstance(payload, dict):
        raise ValueError("OpenAI returned an invalid rewritten recipe structure.")
    return payload


def rewrite_facebook_recipe_post(
    *,
    recipe_post: str,
    custom_prompt: str,
    openai_api_key: str,
    log: Callable[[str], None] | None = None,
) -> FacebookRewrittenRecipe:
    original = str(recipe_post or "").strip()
    if not original:
        raise ValueError("Recipe Post is missing and cannot be rewritten.")
    prompt = str(custom_prompt or DEFAULT_FACEBOOK_RECIPE_REWRITE_PROMPT).strip()
    if "{recipe_post}" in prompt:
        prompt = prompt.replace("{recipe_post}", original)
    else:
        prompt = f"{prompt}\n\nOriginal Recipe Post:\n{original}"

    output_contract = """

Return only one valid JSON object with exactly this structure:
{
  "recipe_title": "title only",
  "rewritten_recipe": "the complete rewritten recipe",
  "ingredients": ["first ingredient", "second ingredient"]
}

The ingredients array must contain only the first 8 ingredients from the rewritten recipe, without bullets. Do not return Markdown fences."""
    emit = log or (lambda _message: None)
    emit("Rewriting Recipe Post and extracting the title and first 8 ingredients.")
    try:
        client = OpenAI(api_key=openai_api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You rewrite recipes faithfully and return strict JSON. "
                        "Never include commentary outside the JSON object."
                    ),
                },
                {"role": "user", "content": prompt + output_contract},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
            max_tokens=3000,
        )
    except Exception as exc:
        raise ValueError(f"Recipe Post rewrite failed: {exc}") from exc

    raw_response = response.choices[0].message.content if response.choices else ""
    payload = _json_payload(raw_response or "")
    rewritten = str(
        payload.get("rewritten_recipe") or payload.get("recipe_post") or ""
    ).strip()
    title = _clean_title(payload.get("recipe_title"))
    if not title and rewritten:
        title = _clean_title(next((line for line in rewritten.splitlines() if line.strip()), ""))
    if not rewritten or not title:
        raise ValueError("OpenAI returned a rewritten recipe without a title or recipe text.")

    raw_ingredients = payload.get("ingredients")
    if isinstance(raw_ingredients, str):
        raw_ingredients = raw_ingredients.splitlines()
    ingredients = []
    if isinstance(raw_ingredients, list):
        ingredients = [
            ingredient
            for ingredient in (_clean_ingredient(value) for value in raw_ingredients)
            if ingredient
        ][:8]
    if not ingredients:
        ingredients = _ingredients_from_recipe(rewritten)
    if not ingredients:
        raise ValueError("OpenAI returned a rewritten recipe without ingredients.")

    return FacebookRewrittenRecipe(
        recipe_title=title,
        recipe_post=rewritten,
        ingredient_recipe="\n".join(f"- {ingredient}" for ingredient in ingredients[:8]),
    )

