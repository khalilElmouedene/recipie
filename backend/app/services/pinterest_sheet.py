"""Rows for the private Midjourney sheet download."""
from __future__ import annotations

import asyncio
import json
import re
from urllib.parse import urlsplit

from openai import AsyncOpenAI

from .openai_service import _response_text
from .prompts import get_prompt


SHEET_AI_TIMEOUT_SECONDS = 25


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
                prompt = get_prompt(prompts, key).format(article=content, recipe_title=content)
                response = await client.chat.completions.create(
                    model="gpt-4o-mini", messages=[{"role": "user", "content": prompt}],
                    temperature=0.7, max_tokens=1000,
                )
                result = re.sub(r'[*#"]', '', _response_text(response)).strip()
                if not result:
                    raise ValueError("AI returned empty Pinterest metadata")
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


def sheet_rows(recipe, image_urls: list[str]) -> list[dict[str, str]]:
    return [{
        "title": recipe.pin_title or recipe.recipe_text.split("\n", 1)[0].strip(),
        "image_url": url,
        "description": recipe.pin_description or "",
        "tags": recipe.pin_tags or "",
        "article_link": recipe.pin_blog_link or recipe.wp_permalink or "",
        "status": recipe.status.value,
        "board": recipe.pin_board or "",
    } for url in image_urls]
