from __future__ import annotations

import asyncio
import html
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from sqlalchemy import select

from app.database import SessionLocal
from app.db_models import AutoSpySheet, AutoSpySource, Project


_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
}
_TIMEOUT = httpx.Timeout(25.0, connect=8.0)

# Image URLs containing these substrings are not recipe photos
_IMAGE_SKIP_PATTERNS = re.compile(
    r"(1x1|pixel|tracking|gravatar|avatar|logo|icon|spinner|blank|placeholder"
    r"|\.gif|smiley|emoji|star\.png|rating"
    r"|youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|wistia\.com"
    r"|brightcove|jwplayer|twitch\.tv|tiktok\.com)",
    re.IGNORECASE,
)

# Matches a single <img ...> tag (self-closing or not)
_IMG_TAG_RE = re.compile(r"<img\b[^>]+>", re.IGNORECASE | re.DOTALL)


def _normalize_url(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    return raw


def _domain_from_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc or parsed.path
    return host.removeprefix("www.")


def _extract_image_from_html(html_str: str) -> str:
    """Return the first plausible photo URL from an HTML string.

    Only looks inside <img> tags — never picks up <iframe src> or other
    elements, which would give video embed URLs instead of images.
    """
    if not html_str:
        return ""

    full_size: str = ""
    any_size: str = ""

    for img_tag in _IMG_TAG_RE.finditer(html_str):
        tag = img_tag.group(0)
        for attr in ("src", "data-src", "data-lazy-src", "data-original", "data-lazy"):
            m = re.search(rf'{attr}=["\']([^"\']+)["\']', tag, re.IGNORECASE)
            if not m:
                continue
            url = m.group(1).strip()
            if not url.startswith("http"):
                continue
            if _IMAGE_SKIP_PATTERNS.search(url):
                continue
            if not any_size:
                any_size = url
            # Prefer images that aren't WordPress-resized thumbnails (-300x200.jpg)
            if not full_size and not re.search(r"-\d{2,4}x\d{2,4}\.", url):
                full_size = url
            if full_size:
                break
        if full_size:
            break

    return full_size or any_size


def _best_image_from_media_list(media_list: list) -> str:
    """Extract source_url from a wp:featuredmedia embed list."""
    for media in media_list:
        if not isinstance(media, dict):
            continue
        # Skip WP REST error objects
        if "code" in media and "source_url" not in media:
            continue
        url = media.get("source_url", "")
        if url:
            return url
        # Some themes return sizes dict instead
        sizes = media.get("media_details", {}).get("sizes", {})
        for size in ("full", "large", "medium_large", "medium"):
            sz = sizes.get(size, {})
            if isinstance(sz, dict) and sz.get("source_url"):
                return sz["source_url"]
    return ""


async def _scrape_wp_rest(base_url: str, after: datetime | None) -> list[dict]:
    params: dict = {
        "per_page": 50,
        "orderby": "date",
        "order": "desc",
        "_embed": "wp:featuredmedia",
    }
    if after:
        params["after"] = after.strftime("%Y-%m-%dT%H:%M:%SZ")

    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(f"{base_url}/wp-json/wp/v2/posts", params=params)
        resp.raise_for_status()
        posts = resp.json()

    if not isinstance(posts, list):
        return []

    results = []
    for post in posts:
        title = html.unescape(post.get("title", {}).get("rendered", "")).strip()
        if not title:
            continue

        image_url = ""

        # 1. wp:featuredmedia embed (most reliable)
        media_list = post.get("_embedded", {}).get("wp:featuredmedia", [])
        if media_list:
            image_url = _best_image_from_media_list(media_list)

        # 2. jetpack_featured_media_url (Jetpack-powered sites)
        if not image_url:
            image_url = post.get("jetpack_featured_media_url", "")

        # 3. First <img> in post content
        if not image_url:
            content_html = post.get("content", {}).get("rendered", "")
            image_url = _extract_image_from_html(content_html)

        # 4. First <img> in excerpt
        if not image_url:
            excerpt_html = post.get("excerpt", {}).get("rendered", "")
            image_url = _extract_image_from_html(excerpt_html)

        if image_url:
            results.append({"image_url": image_url, "recipe_text": title})

    return results


async def _scrape_rss(base_url: str) -> list[dict]:
    import xml.etree.ElementTree as ET

    feed_paths = ["/feed/", "/?feed=rss2", "/rss/", "/feed/rss/", "/index.xml"]
    rss_text = ""
    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True) as client:
        for path in feed_paths:
            try:
                resp = await client.get(f"{base_url}{path}")
                if resp.status_code == 200 and resp.text.strip().startswith("<"):
                    rss_text = resp.text
                    break
            except Exception:
                continue

    if not rss_text:
        return []

    try:
        root = ET.fromstring(rss_text)
    except ET.ParseError:
        return []

    ns = {
        "media":   "http://search.yahoo.com/mrss/",
        "content": "http://purl.org/rss/1.0/modules/content/",
        "dc":      "http://purl.org/dc/elements/1.1/",
    }
    results = []
    for item in root.iter("item"):
        title_el = item.find("title")
        title = html.unescape(title_el.text or "").strip() if title_el is not None else ""
        if not title:
            continue

        image_url = ""

        # media:content
        mc = item.find("media:content", ns)
        if mc is not None:
            url = mc.get("url", "")
            if url and not _IMAGE_SKIP_PATTERNS.search(url):
                image_url = url

        # media:thumbnail
        if not image_url:
            mt = item.find("media:thumbnail", ns)
            if mt is not None:
                url = mt.get("url", "")
                if url and not _IMAGE_SKIP_PATTERNS.search(url):
                    image_url = url

        # enclosure
        if not image_url:
            enc = item.find("enclosure")
            if enc is not None and (enc.get("type", "").startswith("image")):
                image_url = enc.get("url", "")

        # content:encoded CDATA (most common on WordPress)
        if not image_url:
            ce = item.find("content:encoded", ns)
            if ce is not None and ce.text:
                image_url = _extract_image_from_html(ce.text)

        # description CDATA fallback
        if not image_url:
            desc = item.find("description")
            if desc is not None and desc.text:
                image_url = _extract_image_from_html(desc.text)

        if image_url:
            results.append({"image_url": image_url, "recipe_text": title})

    return results


async def scrape_source_rows(url: str, after: datetime | None) -> list[dict]:
    base_url = _normalize_url(url)
    try:
        rows = await _scrape_wp_rest(base_url, after)
        if rows:
            return rows
    except Exception:
        pass
    try:
        return await _scrape_rss(base_url)
    except Exception:
        return []


def _make_empty_sheet_data(rows: int = 50, cols: int = 10) -> dict:
    return {"cells": {}, "colWidths": {}, "rowHeights": {}, "rows": rows, "cols": cols}


def _make_sheet_tab(tab_id: str, name: str) -> dict:
    data = _make_empty_sheet_data()
    data["cells"]["0_0"] = {"v": "image_url"}
    data["cells"]["0_1"] = {"v": "recipe_text"}
    return {"id": tab_id, "name": name, "data": data}


def _load_workbook(raw: str | None) -> dict:
    if raw:
        try:
            return json.loads(raw)
        except Exception:
            pass
    return {"sheets": [], "activeId": ""}


def _save_workbook(workbook: dict) -> str:
    return json.dumps(workbook)


def _existing_urls_in_tab(workbook: dict, tab_id: str) -> set[str]:
    """Return the set of image_url values already stored in a sheet tab."""
    tab = next((s for s in workbook.get("sheets", []) if s["id"] == tab_id), None)
    if tab is None:
        return set()
    cells = tab["data"].get("cells", {})
    urls: set[str] = set()
    for key, cell in cells.items():
        if key.endswith("_0"):
            v = (cell.get("v") or "").strip()
            if v and v != "image_url":
                urls.add(v)
    return urls


def _append_rows_to_tab(workbook: dict, tab_id: str, rows: list[dict]) -> int:
    """Append *rows* to the tab (skipping duplicates). Returns number of new rows added."""
    tab = next((s for s in workbook.get("sheets", []) if s["id"] == tab_id), None)
    if tab is None:
        return 0

    cells: dict = tab["data"].get("cells", {})
    existing_urls = _existing_urls_in_tab(workbook, tab_id)

    occupied_rows = {int(k.split("_")[0]) for k in cells if "_" in k}
    next_row = max(occupied_rows, default=0) + 1

    added = 0
    for item in rows:
        img = item.get("image_url", "").strip()
        if not img or img in existing_urls:
            continue
        cells[f"{next_row}_0"] = {"v": img}
        cells[f"{next_row}_1"] = {"v": item.get("recipe_text", "")}
        existing_urls.add(img)
        next_row += 1
        added += 1

    tab["data"]["cells"] = cells
    tab["data"]["rows"] = max(tab["data"].get("rows", 50), next_row + 10)
    return added


_VISION_PROMPT = (
    "Look at this image carefully and answer YES or NO.\n"
    "Answer YES only if ALL THREE conditions are met:\n"
    "  1. FOOD: The image is primarily a photo of food, a dish, a drink, a dessert, "
    "a snack, or an ingredient — it must be a food/recipe photo.\n"
    "  2. NO HUMANS: There are absolutely NO people, faces, hands, arms, legs, "
    "fingers, or any human body part visible anywhere in the image.\n"
    "  3. NO TEXT: There is NO text, words, letters, numbers, title, caption, "
    "watermark, logo, or graphic overlay of any kind anywhere on the image — "
    "even small or partial text means NO.\n"
    "If any one condition fails, answer NO.\n"
    "Reply with only the single word YES or NO."
)


async def _image_url_to_b64(url: str) -> str | None:
    """Download an image and return it as a base64 data URI for OpenAI Vision.

    Needed when OpenAI's servers cannot reach the image URL directly
    (private CDN, Cloudflare-protected, etc.).
    """
    if url.startswith("data:"):
        return url  # already inline
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15.0),
            headers={"User-Agent": "Mozilla/5.0"},
            follow_redirects=True,
        ) as client:
            r = await client.get(url)
            r.raise_for_status()
            ctype = r.headers.get("content-type", "image/jpeg").split(";")[0].strip() or "image/jpeg"
            import base64 as _b64
            return f"data:{ctype};base64,{_b64.b64encode(r.content).decode()}"
    except Exception:
        return None


async def _is_food_image(image_url: str, openai_key: str) -> bool:
    """Return True if the image passes all food/people/text checks via GPT-4o-mini vision.

    First tries passing the URL directly to OpenAI. If that fails (unreachable URL,
    CDN block, etc.) it downloads the image itself and sends it as a base64 data URI.
    Returns False on persistent failure so bad images are never silently kept.
    """
    async def _call(url_or_data: str) -> bool | None:
        """Make one OpenAI vision call. Returns None on error."""
        try:
            payload = {
                "model": "gpt-4o-mini",
                "max_tokens": 5,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": url_or_data, "detail": "low"},
                            },
                            {"type": "text", "text": _VISION_PROMPT},
                        ],
                    }
                ],
            }
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {openai_key}"},
                    json=payload,
                )
                resp.raise_for_status()
            answer = resp.json()["choices"][0]["message"]["content"].strip().upper()
            return answer.startswith("YES")
        except Exception:
            return None

    # Try direct URL first
    result = await _call(image_url)
    if result is not None:
        return result

    # OpenAI couldn't fetch the URL — download it ourselves and send inline
    data_uri = await _image_url_to_b64(image_url)
    if data_uri:
        result = await _call(data_uri)
        if result is not None:
            return result

    # Both attempts failed — reject the image (filter is active, don't let it through)
    return False


async def _filter_food_rows(
    rows: list[dict],
    openai_key: str,
    max_concurrent: int = 5,
) -> list[dict]:
    """Filter *rows* keeping only those whose image passes AI food checks."""
    if not rows or not openai_key:
        return rows

    sem = asyncio.Semaphore(max_concurrent)

    async def _check(row: dict) -> tuple[dict, bool]:
        async with sem:
            ok = await _is_food_image(row["image_url"], openai_key)
            return row, ok

    results = await asyncio.gather(*[_check(r) for r in rows])
    return [row for row, ok in results if ok]


async def _get_project_openai_key(project_id: uuid.UUID, created_by_user_id: uuid.UUID | None) -> str | None:
    """Load the OpenAI key for the project from the DB, or None if unavailable."""
    try:
        from .credentials_loader import load_credentials_for_job
        async with SessionLocal() as db:
            # Use project owner if no specific user
            if created_by_user_id is None:
                prj = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
                created_by_user_id = prj.owner_id if prj else uuid.uuid4()
            creds = await load_credentials_for_job(db, project_id, created_by_user_id)
            return creds.get("openai") or None
    except Exception:
        return None


async def scan_source(source_id: uuid.UUID, force: bool = False) -> None:
    """Scrape a source and append new rows to its sheet tab.

    Only articles published within the last 7 days are fetched.
    *force=True* (manual "Scan Now") uses the same 7-day window so repeated
    clicks are safe — deduplication by image URL prevents duplicate rows.
    """
    async with SessionLocal() as db:
        result = await db.execute(select(AutoSpySource).where(AutoSpySource.id == source_id))
        source = result.scalar_one_or_none()
        if source is None:
            return

        one_week_ago = datetime.now(timezone.utc) - timedelta(weeks=1)

        if force:
            # Manual scan: always look back exactly 7 days
            after = one_week_ago
        else:
            # Scheduler: use last_scanned_at but never go further back than 7 days
            after = max(source.last_scanned_at, one_week_ago) if source.last_scanned_at else one_week_ago

        rows = await scrape_source_rows(source.url, after)

        # AI image filtering — keep only real food images with no people/text.
        # Runs concurrently (up to 5 at once). Falls through gracefully if no key.
        if rows:
            openai_key = await _get_project_openai_key(
                source.project_id, source.created_by_user_id
            )
            if openai_key:
                rows = await _filter_food_rows(rows, openai_key)

        sheet_result = await db.execute(
            select(AutoSpySheet).where(AutoSpySheet.project_id == source.project_id)
        )
        sheet = sheet_result.scalar_one_or_none()

        workbook = _load_workbook(sheet.data if sheet else None)
        _append_rows_to_tab(workbook, source.sheet_tab_id, rows)

        now = datetime.now(timezone.utc)
        if sheet is None:
            sheet = AutoSpySheet(
                project_id=source.project_id,
                data=_save_workbook(workbook),
                updated_at=now,
            )
            db.add(sheet)
        else:
            sheet.data = _save_workbook(workbook)
            sheet.updated_at = now

        source.last_scanned_at = now
        source.next_scan_at = now + timedelta(hours=24)
        await db.commit()


async def run_auto_spy_scheduler(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        now = datetime.now(timezone.utc)
        async with SessionLocal() as db:
            result = await db.execute(
                select(AutoSpySource).where(
                    AutoSpySource.next_scan_at.isnot(None),
                    AutoSpySource.next_scan_at <= now,
                )
            )
            due = result.scalars().all()
            source_ids = [s.id for s in due]

        for sid in source_ids:
            try:
                await scan_source(sid, force=False)
            except Exception:
                pass

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=60)
        except asyncio.TimeoutError:
            pass
