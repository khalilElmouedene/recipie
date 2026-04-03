from __future__ import annotations
import json
import re
import threading
import time
import unicodedata
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path
from random import randint
from typing import Callable
from urllib.parse import urljoin, urlparse

import requests

from . import midjourney, openai_service
from app.config import settings

# Global lock — ensures only ONE Midjourney generation runs at a time across
# all concurrent jobs. Prevents two recipes from polling the same Discord
# channel simultaneously and stealing each other's results.
_midjourney_lock = threading.Lock()

UPLOADS_DIR = Path("/app/uploads")


def _cache_image(url: str, log: Callable[[str], None] | None = None) -> str:
    """Download a Discord CDN image and save it locally. Returns the permanent server URL."""
    _log = log or print
    try:
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
        r.raise_for_status()
        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid.uuid4().hex}.webp"
        dest = UPLOADS_DIR / filename
        dest.write_bytes(r.content)
        permanent_url = f"{settings.server_base_url.rstrip('/')}/uploads/{filename}"
        _log(f"Image cached locally: {filename}")
        return permanent_url
    except Exception as e:
        _log(f"Image cache failed, keeping original URL: {e}")
        return url


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


def _fetch_sitemap_urls(sitemap_url: str) -> list[str]:
    """Fetch all <loc> URLs from a single sitemap XML file."""
    r = requests.get(sitemap_url, timeout=15)
    r.raise_for_status()
    root = ET.fromstring(r.content)
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    return [
        loc.text
        for url_el in root.findall(".//s:url", ns)
        if (loc := url_el.find("s:loc", ns)) is not None and loc.text
    ]


_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif", ".ico", ".bmp")


def _is_media_url(url: str) -> bool:
    """Return True if the URL points to a media file rather than a post/page."""
    lower = url.lower().split("?")[0]
    if "/wp-content/uploads/" in lower:
        return True
    if any(lower.endswith(ext) for ext in _IMAGE_EXTENSIONS):
        return True
    return False


def _parse_sitemap_xml(xml_content: bytes) -> tuple[list[str], list[str]]:
    """Parse sitemap XML content and return (child_sitemaps, page_urls).

    Only the canonical <loc> inside <url> (not <image:loc> or <video:loc>) is
    included in page_urls.  We detect those by checking the *parent* tag name:
    if the immediate parent ends with 'url' it is a post URL; otherwise it is a
    media/image sub-element and is skipped.
    """
    try:
        root = ET.fromstring(xml_content)
    except Exception:
        return [], []

    child_sitemaps: list[str] = []
    page_urls: list[str] = []

    is_index = "sitemapindex" in (root.tag or "").lower()

    # Build a parent-map so we can check immediate parent tags.
    parent_map: dict = {child: parent for parent in root.iter() for child in parent}

    for el in root.iter():
        tag = (el.tag or "").lower()
        text = (el.text or "").strip()
        if not text or not tag.endswith("loc"):
            continue

        if is_index:
            child_sitemaps.append(text)
        else:
            # Only include loc elements whose immediate parent tag ends with "url"
            # (i.e. the canonical <url><loc>…</loc></url> pattern).
            parent = parent_map.get(el)
            parent_tag = (parent.tag or "").lower() if parent is not None else ""
            if not parent_tag.endswith("url"):
                continue  # skip <image:loc>, <video:loc>, etc.
            if _is_media_url(text):
                continue
            page_urls.append(text)

    if is_index:
        return child_sitemaps, []
    return [], page_urls


def _extract_same_domain_links_from_html(html: str, site_domain: str) -> list[str]:
    """Best-effort fallback if sitemap is unavailable."""
    if not html:
        return []
    base_host = (urlparse(site_domain).hostname or "").lower()
    if not base_host:
        return []

    hrefs = re.findall(r'href=["\']([^"\']+)["\']', html, flags=re.IGNORECASE)
    seen: set[str] = set()
    out: list[str] = []
    for href in hrefs:
        abs_url = urljoin(site_domain + "/", href.strip())
        parsed = urlparse(abs_url)
        if parsed.scheme not in ("http", "https"):
            continue
        host = (parsed.hostname or "").lower()
        if not host:
            continue
        if host != base_host and host != f"www.{base_host}" and base_host != f"www.{host}":
            continue
        if parsed.path in ("", "/", "/#"):
            continue
        clean_url = f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")
        if clean_url in seen:
            continue
        seen.add(clean_url)
        out.append(clean_url)
        if len(out) >= 50:
            break
    return out


def get_sitemap_links(site_domain: str, log: Callable[[str], None] | None = None) -> list[str]:
    """
    Try multiple common sitemap locations for the site and return up to 50 post URLs.
    Handles both sitemap index files and direct sitemap XML.
    """
    if not site_domain.startswith(("http://", "https://")):
        site_domain = "https://" + site_domain
    site_domain = site_domain.rstrip("/")

    parsed = urlparse(site_domain)
    host = parsed.netloc
    scheme_variants = [parsed.scheme]
    if parsed.scheme == "https":
        scheme_variants.append("http")
    elif parsed.scheme == "http":
        scheme_variants.append("https")

    domain_variants = []
    for scheme in scheme_variants:
        domain_variants.append(f"{scheme}://{host}".rstrip("/"))
        if host.startswith("www."):
            domain_variants.append(f"{scheme}://{host[4:]}".rstrip("/"))
        else:
            domain_variants.append(f"{scheme}://www.{host}".rstrip("/"))

    # Preserve order and uniqueness.
    domain_variants = list(dict.fromkeys(domain_variants))
    headers = {"User-Agent": "Mozilla/5.0"}
    candidates: list[str] = []
    for base in domain_variants:
        candidates.extend([
            f"{base}/post-sitemap.xml",
            f"{base}/post-sitemap1.xml",
            f"{base}/wp-sitemap.xml",
            f"{base}/wp-sitemap-posts-post-1.xml",
            f"{base}/sitemap.xml",
            f"{base}/sitemap_index.xml",
        ])

    # Also read robots.txt sitemap hints.
    for base in domain_variants:
        try:
            robots = requests.get(f"{base}/robots.txt", timeout=10, headers=headers)
            if robots.status_code == 200 and robots.text:
                for line in robots.text.splitlines():
                    if line.lower().startswith("sitemap:"):
                        sm = line.split(":", 1)[1].strip()
                        if sm:
                            candidates.append(sm)
        except Exception:
            pass

    candidates = list(dict.fromkeys(candidates))
    _log = log or (lambda _: None)

    for url in candidates:
        try:
            r = requests.get(url, timeout=15, headers=headers)
            if r.status_code != 200:
                continue
            child_sitemaps, page_urls = _parse_sitemap_xml(r.content)
            if child_sitemaps:
                links: list[str] = []
                for child_url in child_sitemaps[:8]:
                    try:
                        child_resp = requests.get(child_url, timeout=15, headers=headers)
                        if child_resp.status_code != 200:
                            continue
                        _, child_urls = _parse_sitemap_xml(child_resp.content)
                        links.extend(child_urls)
                    except Exception:
                        pass
                    if len(links) >= 50:
                        break
                if links:
                    result = list(dict.fromkeys(links))[:50]
                    _log(f"Sitemap index found at {url} → {len(result)} post URLs")
                    return result
            else:
                if page_urls:
                    result = list(dict.fromkeys(page_urls))[:50]
                    _log(f"Sitemap found at {url} → {len(result)} post URLs")
                    return result
        except Exception:
            continue

    # Fallback: crawl homepage links if all sitemap variants fail.
    _log("No sitemap found — falling back to homepage link crawl")
    for base in domain_variants:
        try:
            r = requests.get(base, timeout=15, headers=headers)
            if r.status_code != 200:
                continue
            links = _extract_same_domain_links_from_html(r.text, base)
            if links:
                _log(f"Homepage crawl found {len(links)} links")
                return links[:50]
        except Exception:
            continue

    _log("WARNING: No internal links found — article will use fallback category links")
    return []


def generate_for_recipe(
    recipe_id: str,
    recipe_text: str,
    image_url: str,
    site_domain: str,
    credentials: dict,
    prompts: dict[str, str] | None = None,
    log: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> dict:
    """Generate all content for a single recipe. Returns a dict of fields to update on the Recipe row."""
    _log = log or print
    _stop = should_stop or (lambda: False)

    openai_key = credentials.get("openai", "").strip()
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
        full_recipe = openai_service.generate_full_recipe(recipe_title, openai_key, prompts=prompts, log=_log)
        result["generated_full_recipe"] = full_recipe

        # 3. Generate recipe JSON for WP Recipe Maker
        if _stop():
            return result
        _log("Generating recipe JSON...")
        recipe_json = openai_service.generate_recipe_json(recipe_title, full_recipe, "", openai_key, prompts=prompts, log=_log)
        result["generated_json"] = recipe_json

        # 4. Generate article HTML
        if _stop():
            return result
        _log("Generating article HTML...")
        internal_links = get_sitemap_links(site_domain, log=_log)
        _log(f"Found {len(internal_links)} internal links from sitemap")
        article = openai_service.generate_article(recipe_title, full_recipe, "", internal_links, openai_key, prompts=prompts, log=_log, site_domain=site_domain)
        result["generated_article"] = article

        # 5. Meta description
        if _stop():
            return result
        _log("Generating meta description...")
        meta = openai_service.generate_meta_description(recipe_title, openai_key, prompts=prompts, log=_log)
        result["meta_description"] = meta

        # 6. Category
        if _stop():
            return result
        _log("Generating category...")
        category = openai_service.generate_category(recipe_title, openai_key, prompts=prompts, log=_log)
        result["category"] = category

        # 6b. Pinterest board selection (AI picks best board from boards list)
        from .prompts import DEFAULT_PROMPTS as _DP
        boards_list = (prompts or {}).get("pinterest_boards_list") or _DP.get("pinterest_boards_list", {}).get("value", "")
        if boards_list and not _stop():
            _log("Selecting Pinterest board...")
            try:
                pin_board = openai_service.generate_pinterest_pin_board(
                    recipe_title, boards_list, openai_key, prompts=prompts, log=_log
                )
                pin_board = pin_board.strip().strip('"').strip("'")
                result["pin_board"] = pin_board
                _log(f"Pinterest board selected: {pin_board}")
            except Exception as e:
                _log(f"Pinterest board selection failed (non-fatal): {e}")

        # 7. Midjourney images (only if Discord credentials exist)
        discord_auth = credentials.get("discord_auth", "")
        if discord_auth and image_url:
            if _stop():
                return result
            _log("Waiting for Midjourney queue slot (one recipe at a time)...")
            with _midjourney_lock:
                if _stop():
                    return result
                _log("Midjourney slot acquired — generating images...")
                try:
                    img_urls = midjourney.generate_images(recipe_title, image_url, credentials, prompts=prompts, wait_time=190, log=_log)
                    # Cache immediately — Discord CDN URLs expire after a few hours
                    cached_urls = [_cache_image(u, log=_log) for u in img_urls if u]
                    result["generated_images"] = json.dumps(cached_urls)
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


def generate_images_only(
    recipe_title: str,
    image_url: str,
    credentials: dict,
    prompts: dict[str, str] | None = None,
    log: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> str | None:
    """Generate Midjourney images only and return JSON string urls (or None)."""
    _log = log or print
    _stop = should_stop or (lambda: False)
    discord_auth = credentials.get("discord_auth", "")
    if not discord_auth or not image_url:
        _log("Skipping Midjourney (no Discord credentials configured)")
        return None
    if _stop():
        return None
    _log("Waiting for Midjourney queue slot (one recipe at a time)...")
    with _midjourney_lock:
        if _stop():
            return None
        _log("Midjourney slot acquired — generating images...")
        img_urls = midjourney.generate_images(recipe_title, image_url, credentials, prompts=prompts, wait_time=190, log=_log)
        cached_urls = [_cache_image(u, log=_log) for u in img_urls if u]
        return json.dumps(cached_urls)


def process_recipes_from_db(
    recipes: list[dict],
    site_domain: str,
    credentials: dict,
    prompts: dict[str, str] | None = None,
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
            prompts=prompts,
            log=_log,
            should_stop=_stop,
        )

        if on_recipe_done:
            on_recipe_done(recipe_id, generated)

        if idx < total - 1:
            _log("Waiting 5s before next recipe...")
            time.sleep(5)

    _log("\n=== ALL RECIPES PROCESSED ===")
