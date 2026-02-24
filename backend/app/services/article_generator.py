from __future__ import annotations
import json
import re
import time
import unicodedata
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from random import randint
from typing import Callable

import requests

from . import midjourney, openai_service


def clean_keyword(text: str) -> str:
    if not text:
        return ""
    zero_width = ["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff", "\u00ad"]
    cleaned = text
    for ch in zero_width:
        cleaned = cleaned.replace(ch, "")
    cleaned = unicodedata.normalize("NFKC", cleaned)
    cleaned = re.sub(r'&[a-zA-Z0-9#]+;', '', cleaned)
    cleaned = "".join(c for c in cleaned if c.isprintable() or c in " \t\n")
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    cleaned = "".join(c for c in cleaned if ord(c) >= 32 or c in "\t\n")
    return cleaned


def get_sitemap_links(sitemap_url: str) -> list[str]:
    try:
        if not sitemap_url.startswith(("http://", "https://")):
            sitemap_url = "https://" + sitemap_url
        r = requests.get(sitemap_url, timeout=15)
        r.raise_for_status()
        root = ET.fromstring(r.content)
        ns = {"sitemap": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        return [
            loc.text
            for url_el in root.findall(".//sitemap:url", ns)
            if (loc := url_el.find("sitemap:loc", ns)) is not None
        ]
    except Exception:
        return []


def generate_for_recipe(
    recipe_id: str,
    recipe_text: str,
    image_url: str,
    site_domain: str,
    credentials: dict,
    log: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> dict:
    """Generate all content for a single recipe. Returns a dict of fields to update on the Recipe row."""
    _log = log or print
    _stop = should_stop or (lambda: False)

    openai_key = credentials.get("openai", "")
    recipe_title = recipe_text.splitlines()[0].strip() if recipe_text else "Untitled Recipe"
    result: dict = {}

    try:
        if _stop():
            return result

        # 1. Focus keyword
        focus_keyword = re.sub(r'[*#"]', '', clean_keyword(recipe_title))
        result["focus_keyword"] = focus_keyword
        _log(f"Focus keyword: {focus_keyword}")

        # 2. Generate full recipe
        if _stop():
            return result
        _log("Generating full recipe...")
        full_recipe = openai_service.generate_full_recipe(recipe_title, openai_key, log=_log)
        result["generated_full_recipe"] = full_recipe

        # 3. Generate recipe JSON for WP Recipe Maker
        if _stop():
            return result
        _log("Generating recipe JSON...")
        recipe_json = openai_service.generate_recipe_json(recipe_title, full_recipe, "", openai_key, log=_log)
        result["generated_json"] = recipe_json

        # 4. Generate article HTML
        if _stop():
            return result
        _log("Generating article HTML...")
        internal_links = get_sitemap_links(site_domain + "/post-sitemap1.xml")
        article = openai_service.generate_article(recipe_title, full_recipe, "", internal_links, openai_key, log=_log)
        result["generated_article"] = article

        # 5. Meta description
        if _stop():
            return result
        _log("Generating meta description...")
        meta = openai_service.generate_meta_description(recipe_title, openai_key, log=_log)
        result["meta_description"] = meta

        # 6. Category
        if _stop():
            return result
        _log("Generating category...")
        category = openai_service.generate_category(recipe_title, openai_key, log=_log)
        result["category"] = category

        # 7. Midjourney images (only if Discord credentials exist)
        discord_auth = credentials.get("discord_auth", "")
        if discord_auth and image_url:
            if _stop():
                return result
            _log("Generating Midjourney images...")
            try:
                img_urls = midjourney.generate_images(recipe_title, image_url, credentials, wait_time=190, log=_log)
                result["generated_images"] = json.dumps(img_urls)
            except Exception as e:
                _log(f"Midjourney failed (non-fatal): {e}")
        else:
            _log("Skipping Midjourney (no Discord credentials configured)")

        _log(f"Content generation complete for: {recipe_title}")
        return result

    except Exception as e:
        _log(f"Error generating content: {e}")
        result["error_message"] = str(e)
        return result


def process_recipes_from_db(
    recipes: list[dict],
    site_domain: str,
    credentials: dict,
    log: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    on_progress: Callable[[int, int], None] | None = None,
    on_recipe_done: Callable[[str, dict], None] | None = None,
):
    """Process a list of pending recipes from the database.
    recipes: list of dicts with id, recipe_text, image_url.
    on_recipe_done: callback(recipe_id, generated_fields_dict) to persist results.
    """
    _log = log or print
    _stop = should_stop or (lambda: False)
    total = len(recipes)

    _log(f"=== GENERATING CONTENT FOR {total} RECIPES ===")

    for idx, recipe in enumerate(recipes):
        if _stop():
            _log("STOP REQUESTED — aborting")
            return

        recipe_id = recipe["id"]
        recipe_text = recipe["recipe_text"]
        image_url = recipe["image_url"]

        _log(f"\n{'=' * 50}")
        _log(f"RECIPE {idx + 1}/{total}: {recipe_text.splitlines()[0][:60] if recipe_text else 'Untitled'}")
        _log(f"{'=' * 50}")

        if on_progress:
            on_progress(idx + 1, total)

        generated = generate_for_recipe(
            recipe_id=recipe_id,
            recipe_text=recipe_text,
            image_url=image_url,
            site_domain=site_domain,
            credentials=credentials,
            log=_log,
            should_stop=_stop,
        )

        if on_recipe_done:
            on_recipe_done(recipe_id, generated)

        if idx < total - 1:
            _log("Waiting 5s before next recipe...")
            time.sleep(5)

    _log("\n=== ALL RECIPES PROCESSED ===")
