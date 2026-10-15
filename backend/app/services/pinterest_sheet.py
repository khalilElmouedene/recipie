"""Rows for the private Midjourney sheet download."""
from __future__ import annotations

import json
from urllib.parse import urlsplit


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
