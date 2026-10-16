"""Rows for the private Midjourney sheet download."""
from __future__ import annotations

import asyncio
import json
import re
from urllib.parse import urlsplit, urlunsplit

from openai import AsyncOpenAI

from .openai_service import _response_text
from .prompts import get_prompt


SHEET_AI_TIMEOUT_SECONDS = 25


class SheetMetadataError(ValueError):
    """Safe, field-specific failure suitable for the export error message."""


def render_sheet_prompt(template: str, content: str) -> str:
    # Saved prompts may include JSON examples or literal braces. Do not parse
    # them as Python format expressions, or substitute inside recipe content.
    placeholders = {"article", "recipe_title", "recipe_name", "title", "recipe_text",
                    "full_recipe", "new_recipe", "content"}
    inserted = False

    def replace(match: re.Match) -> str:
        nonlocal inserted
        if match.group(1) in placeholders:
            inserted = True
            return content
        return match.group(0)

    prompt = re.sub(r"(?<!\{)\{([a-zA-Z_][a-zA-Z_0-9]*)\}(?!\})", replace, template)
    if not inserted:
        prompt += f"\n\nSource article or recipe:\n{content}"
    return prompt


async def generate_sheet_metadata(
    content: str, api_key: str, prompts: dict[str, str],
    description: str | None, tags: str | None,
) -> tuple[str, str]:
    """Keep interactive exports within proxy deadlines, without sleeping/retrying."""
    async with asyncio.timeout(SHEET_AI_TIMEOUT_SECONDS):
        async with AsyncOpenAI(api_key=api_key, timeout=20.0, max_retries=0) as client:
            async def generate(key: str, existing: str | None) -> str:
                if existing and existing.strip():
                    return existing
                field = "description" if key == "pinterest_description" else "tags"
                prompt = render_sheet_prompt(get_prompt(prompts, key), content)
                response = await client.chat.completions.create(
                    model="gpt-4o-mini", messages=[{"role": "user", "content": prompt}],
                    temperature=0.7, max_tokens=2000,
                )
                if not response.choices:
                    raise SheetMetadataError(f"OpenAI returned no result for Pinterest {field}. Please try again.")
                choice = response.choices[0]
                if choice.finish_reason == "length":
                    raise SheetMetadataError(f"OpenAI's Pinterest {field} response was cut off. Shorten the {field} prompt and try again.")
                if choice.finish_reason == "content_filter" or getattr(choice.message, "refusal", None):
                    raise SheetMetadataError(f"OpenAI declined to generate Pinterest {field}. Review the source content and {field} prompt.")
                try:
                    result = re.sub(r'[*#"]', '', _response_text(response)).strip()
                except ValueError:
                    raise SheetMetadataError(f"OpenAI returned empty or unusable Pinterest {field}. Please try again or review the {field} prompt.") from None
                if not result:
                    raise SheetMetadataError(f"OpenAI returned empty Pinterest {field}. Please try again.")
                return result

            # Both calls share one deadline; cancel the sibling call on failure.
            tasks = [asyncio.create_task(generate("pinterest_description", description)),
                     asyncio.create_task(generate("pinterest_tags", tags))]
            try:
                generated_description, generated_tags = await asyncio.gather(*tasks)
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
    return generated_description, generated_tags


def generated_image_urls(raw: str | None) -> list[str]:
    try:
        values = json.loads(raw or "[]")
    except (ValueError, TypeError):
        return []
    if not isinstance(values, list):
        return []
    urls = []
    for value in values:
        if not isinstance(value, str):
            continue
        value = value.strip()
        try:
            parsed = urlsplit(value)
        except ValueError:
            continue
        if parsed.scheme in ("http", "https") and parsed.netloc and value not in urls:
            urls.append(value)
    return urls


def clean_sheet_description(value: str | None) -> str:
    # Clean saved metadata as well as newly generated text on every export.
    return re.sub(r"^\s*(?:\*{1,2}|#{1,6})?\s*(?:pin\s+description|description|beschreibung)\s*(?:\*{1,2})?\s*[:：]\s*(?:\*{1,2})?\s*",
                  "", value or "", flags=re.IGNORECASE).strip()


def article_link(recipe, site=None) -> str:
    # Prefer the published article; a whitespace-only override must not hide it.
    for value in (recipe.wp_permalink, recipe.pin_blog_link):
        if isinstance(value, str) and value.strip():
            parsed = urlsplit(value.strip())
            if parsed.scheme in ("http", "https") and parsed.netloc:
                return value.strip()
    # WordPress supports ?p=ID even when the pretty permalink wasn't saved.
    post_id = str(getattr(recipe, "wp_post_id", "") or "").strip()
    if site is not None and post_id.isdigit() and int(post_id) > 0:
        raw = (getattr(site, "wp_url", "") or getattr(site, "domain", "") or "").strip()
        if raw and not raw.startswith(("https://", "http://")):
            raw = "https://" + raw
        parsed = urlsplit(raw)
        if parsed.scheme in ("http", "https") and parsed.netloc:
            path = re.sub(r"/(?:xmlrpc\.php|wp-admin(?:/.*)?|wp-json(?:/.*)?)$", "", parsed.path).rstrip("/") + "/"
            return urlunsplit((parsed.scheme, parsed.netloc, path, f"p={post_id}", ""))
    return ""


def sheet_rows(recipe, image_urls: list[str], site=None) -> list[dict[str, str]]:
    return [{
        "title": recipe.pin_title or recipe.recipe_text.split("\n", 1)[0].strip(),
        "image_url": url,
        "description": clean_sheet_description(recipe.pin_description),
        "tags": recipe.pin_tags or "",
        "article_link": article_link(recipe, site),
        "status": recipe.status.value,
        "board": recipe.pin_board or "",
    } for url in image_urls[:1]]
