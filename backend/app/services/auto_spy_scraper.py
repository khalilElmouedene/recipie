from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import xml.etree.ElementTree as ET
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
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

_AUTO_SPY_LOOKBACK_DAYS = 30
_MAX_POSTS_PER_SCAN = 10
_SITEMAP_PAGE_SCAN_LIMIT = 30
_SITEMAP_CHILD_SCAN_LIMIT = 16
_SOURCE_METADATA_HEADERS = ("image_url", "recipe_text", "post_url", "published_at")
_LOGGER = logging.getLogger(__name__)

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
_PAGE_SKIP_SEGMENTS = {
    "about",
    "author",
    "cart",
    "category",
    "checkout",
    "contact",
    "disclaimer",
    "feed",
    "login",
    "my-account",
    "newsletter",
    "page",
    "privacy-policy",
    "privacy",
    "shop",
    "tag",
    "terms",
    "wp-content",
    "wp-json",
}
_IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif", ".ico", ".bmp")


@dataclass(frozen=True)
class _SitemapEntry:
    url: str
    lastmod: datetime | None = None


def _normalize_url(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    return raw


def _domain_from_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc or parsed.path
    return host.removeprefix("www.")


def _log_scrape_diagnostic(log: Callable[[str], None] | None, message: str) -> None:
    if log:
        try:
            log(message)
            return
        except Exception:
            pass
    _LOGGER.info(message)


def _origin_from_url(url: str) -> str:
    parsed = urlparse(_normalize_url(url))
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    return _normalize_url(url)


def _clean_image_url(raw: str, base_url: str = "") -> str:
    value = html.unescape(str(raw or "")).strip()
    if not value or value.startswith(("data:", "blob:")):
        return ""
    if value.startswith("//"):
        value = "https:" + value
    if base_url:
        value = urljoin(base_url, value)
    if not value.startswith(("http://", "https://")):
        return ""
    if _IMAGE_SKIP_PATTERNS.search(value):
        return ""
    return value


def _srcset_urls(raw: str, base_url: str = "") -> list[str]:
    urls: list[str] = []
    for item in str(raw or "").split(","):
        candidate = item.strip().split(" ", 1)[0].strip()
        clean = _clean_image_url(candidate, base_url)
        if clean:
            urls.append(clean)
    return urls


def _extract_image_from_html(html_str: str, base_url: str = "") -> str:
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
        for attr in ("srcset", "data-srcset"):
            m = re.search(rf'{attr}=["\']([^"\']+)["\']', tag, re.IGNORECASE)
            if not m:
                continue
            for url in reversed(_srcset_urls(m.group(1), base_url)):
                if not any_size:
                    any_size = url
                if not full_size and not re.search(r"-\d{2,4}x\d{2,4}\.", url):
                    full_size = url
                    break
            if full_size:
                break
        if full_size:
            break

        for attr in ("src", "data-src", "data-lazy-src", "data-original", "data-lazy"):
            m = re.search(rf'{attr}=["\']([^"\']+)["\']', tag, re.IGNORECASE)
            if not m:
                continue
            url = _clean_image_url(m.group(1), base_url)
            if not url:
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


def _parse_any_datetime(raw: object) -> datetime | None:
    value = html.unescape(str(raw or "")).strip()
    if not value or value.startswith("0000-"):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError, IndexError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _published_at_string(raw: object) -> str:
    parsed = _parse_any_datetime(raw)
    if parsed is not None:
        return parsed.isoformat()
    return html.unescape(str(raw or "")).strip()


def _is_media_url(url: str) -> bool:
    lower = url.lower().split("?", 1)[0]
    if "/wp-content/uploads/" in lower:
        return True
    return any(lower.endswith(ext) for ext in _IMAGE_EXTENSIONS)


def _same_site_url(base_url: str, candidate: str) -> bool:
    base_host = (urlparse(base_url).hostname or "").lower().removeprefix("www.")
    candidate_host = (urlparse(candidate).hostname or "").lower().removeprefix("www.")
    return bool(base_host and candidate_host and base_host == candidate_host)


def _should_skip_page_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return True
    if _is_media_url(url):
        return True
    segments = [segment for segment in parsed.path.lower().strip("/").split("/") if segment]
    if not segments:
        return True
    if any(segment in _PAGE_SKIP_SEGMENTS for segment in segments):
        return True
    return False


def _xml_name(tag: str) -> str:
    return (tag or "").rsplit("}", 1)[-1].lower()


def _child_text(element: ET.Element, name: str) -> str:
    for child in list(element):
        if _xml_name(child.tag) == name:
            return (child.text or "").strip()
    return ""


def _parse_sitemap_xml(xml_content: bytes | str) -> tuple[list[str], list[_SitemapEntry]]:
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError:
        return [], []

    if _xml_name(root.tag) == "sitemapindex":
        child_sitemaps = [
            loc
            for sitemap in list(root)
            if _xml_name(sitemap.tag) == "sitemap"
            if (loc := _child_text(sitemap, "loc"))
        ]
        return child_sitemaps, []

    entries: list[_SitemapEntry] = []
    for url_element in list(root):
        if _xml_name(url_element.tag) != "url":
            continue
        loc = _child_text(url_element, "loc")
        if not loc:
            continue
        entries.append(_SitemapEntry(url=loc, lastmod=_parse_any_datetime(_child_text(url_element, "lastmod"))))
    return [], entries


def _domain_variants(base_url: str) -> list[str]:
    parsed = urlparse(_origin_from_url(base_url))
    if not parsed.scheme or not parsed.netloc:
        return []
    schemes = [parsed.scheme]
    if parsed.scheme == "https":
        schemes.append("http")
    elif parsed.scheme == "http":
        schemes.append("https")

    variants: list[str] = []
    for scheme in schemes:
        variants.append(f"{scheme}://{parsed.netloc}".rstrip("/"))
        if parsed.netloc.startswith("www."):
            variants.append(f"{scheme}://{parsed.netloc[4:]}".rstrip("/"))
        else:
            variants.append(f"{scheme}://www.{parsed.netloc}".rstrip("/"))
    return list(dict.fromkeys(variants))


def _sitemap_priority(url: str) -> int:
    lower = url.lower()
    if any(token in lower for token in ("recipe", "post", "posts")):
        return 0
    if any(token in lower for token in ("page", "category", "tag", "author")):
        return 3
    return 1


async def _sitemap_candidates(
    base_url: str,
    client: httpx.AsyncClient,
    log: Callable[[str], None] | None = None,
) -> list[str]:
    candidates: list[str] = []
    for base in _domain_variants(base_url):
        candidates.extend(
            [
                f"{base}/recipe-sitemap.xml",
                f"{base}/recipe-sitemap1.xml",
                f"{base}/post-sitemap.xml",
                f"{base}/post-sitemap1.xml",
                f"{base}/wp-sitemap.xml",
                f"{base}/wp-sitemap-posts-post-1.xml",
                f"{base}/sitemap.xml",
                f"{base}/sitemap_index.xml",
            ]
        )
        try:
            resp = await client.get(f"{base}/robots.txt")
            if resp.status_code == 200:
                for line in resp.text.splitlines():
                    if line.lower().startswith("sitemap:"):
                        sitemap_url = line.split(":", 1)[1].strip()
                        if sitemap_url:
                            candidates.append(sitemap_url)
        except Exception as exc:
            _log_scrape_diagnostic(log, f"robots.txt check failed for {base}: {type(exc).__name__}")
    return list(dict.fromkeys(candidates))


async def _discover_sitemap_entries(
    base_url: str,
    client: httpx.AsyncClient,
    after: datetime | None,
    log: Callable[[str], None] | None = None,
) -> list[_SitemapEntry]:
    queue = await _sitemap_candidates(base_url, client, log)
    queue.sort(key=_sitemap_priority)
    seen_sitemaps: set[str] = set()
    entries: list[_SitemapEntry] = []

    while queue and len(seen_sitemaps) < _SITEMAP_CHILD_SCAN_LIMIT:
        sitemap_url = queue.pop(0)
        if sitemap_url in seen_sitemaps:
            continue
        seen_sitemaps.add(sitemap_url)
        try:
            resp = await client.get(sitemap_url)
        except Exception as exc:
            _log_scrape_diagnostic(log, f"sitemap fetch failed for {sitemap_url}: {type(exc).__name__}")
            continue
        if resp.status_code != 200:
            continue
        child_sitemaps, page_entries = _parse_sitemap_xml(resp.content)
        for child in sorted(child_sitemaps, key=_sitemap_priority):
            if child not in seen_sitemaps and child not in queue:
                queue.append(child)
        for entry in page_entries:
            page_url = entry.url.strip().rstrip("/")
            if not page_url:
                continue
            if not _same_site_url(base_url, page_url):
                continue
            if _should_skip_page_url(page_url):
                continue
            if after and entry.lastmod and entry.lastmod <= after:
                continue
            entries.append(_SitemapEntry(page_url, entry.lastmod))
        if len(entries) >= _SITEMAP_PAGE_SCAN_LIMIT:
            break

    entries = list({entry.url: entry for entry in entries}.values())
    entries.sort(key=lambda entry: entry.lastmod or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return entries[:_SITEMAP_PAGE_SCAN_LIMIT]


def _jsonld_payloads(soup: BeautifulSoup) -> list[object]:
    payloads: list[object] = []
    decoder = json.JSONDecoder()
    for script in soup.find_all("script", attrs={"type": re.compile(r"ld\+json", re.I)}):
        raw = (script.string or script.get_text() or "").strip()
        if not raw:
            continue
        raw = re.sub(r"^\s*<!--", "", raw)
        raw = re.sub(r"-->\s*$", "", raw).strip()
        try:
            payloads.append(json.loads(raw))
            continue
        except json.JSONDecodeError:
            pass

        index = 0
        while index < len(raw):
            next_positions = [pos for pos in (raw.find("{", index), raw.find("[", index)) if pos != -1]
            if not next_positions:
                break
            index = min(next_positions)
            try:
                payload, offset = decoder.raw_decode(raw[index:])
            except json.JSONDecodeError:
                index += 1
                continue
            payloads.append(payload)
            index += offset
    return payloads


def _jsonld_dicts(value: object):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _jsonld_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _jsonld_dicts(child)


def _schema_types(obj: dict) -> set[str]:
    raw = obj.get("@type") or obj.get("type")
    values = raw if isinstance(raw, list) else [raw]
    return {
        str(value).split(":")[-1].lower()
        for value in values
        if value
    }


def _recipe_schema_objects(soup: BeautifulSoup) -> list[dict]:
    recipes: list[dict] = []
    for payload in _jsonld_payloads(soup):
        for obj in _jsonld_dicts(payload):
            if "recipe" in _schema_types(obj):
                recipes.append(obj)
    return recipes


def _first_schema_text(value: object) -> str:
    if isinstance(value, str):
        return html.unescape(value).strip()
    if isinstance(value, list):
        for item in value:
            text = _first_schema_text(item)
            if text:
                return text
    if isinstance(value, dict):
        for key in ("name", "headline", "text", "@value"):
            text = _first_schema_text(value.get(key))
            if text:
                return text
    return ""


def _first_schema_url(value: object, base_url: str) -> str:
    if isinstance(value, str):
        return _clean_image_url(value, base_url)
    if isinstance(value, list):
        for item in value:
            url = _first_schema_url(item, base_url)
            if url:
                return url
    if isinstance(value, dict):
        for key in ("url", "contentUrl", "thumbnailUrl"):
            url = _first_schema_url(value.get(key), base_url)
            if url:
                return url
        schema_id = str(value.get("@id") or "")
        if schema_id and "#" not in schema_id and _is_media_url(schema_id):
            return _clean_image_url(schema_id, base_url)
    return ""


def _meta_content(soup: BeautifulSoup, *names: str) -> str:
    for name in names:
        tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            return html.unescape(str(tag["content"])).strip()
    return ""


def _clean_title(value: str) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = " ".join(text.split()).strip()
    return re.split(r"\s+[|-]\s+", text, maxsplit=1)[0].strip()


def _title_from_page(soup: BeautifulSoup) -> str:
    title = _meta_content(soup, "og:title", "twitter:title")
    if not title:
        h1 = soup.find("h1")
        title = h1.get_text(" ", strip=True) if h1 else ""
    if not title and soup.title:
        title = soup.title.get_text(" ", strip=True)
    return _clean_title(title)


def _image_from_page(soup: BeautifulSoup, page_url: str) -> str:
    for name in ("og:image", "og:image:url", "twitter:image", "twitter:image:src"):
        url = _clean_image_url(_meta_content(soup, name), page_url)
        if url:
            return url
    article = soup.find("article") or soup.find("main") or soup
    return _extract_image_from_html(str(article), page_url)


def _is_recipe_like_page(soup: BeautifulSoup, page_url: str, title: str, has_recipe_schema: bool) -> bool:
    if has_recipe_schema:
        return True
    path = urlparse(page_url).path.lower()
    if "recipe" in path or "recipe" in title.lower():
        return True
    article = soup.find("article") or soup.find("main") or soup
    text = article.get_text(" ", strip=True).lower()[:12000]
    return "ingredients" in text and any(token in text for token in ("instructions", "directions", "method"))


def _published_at_from_recipe_page(
    recipe: dict | None,
    soup: BeautifulSoup,
    lastmod: datetime | None,
) -> str:
    if recipe:
        for key in ("datePublished", "dateCreated", "dateModified"):
            value = _first_schema_text(recipe.get(key))
            if value:
                return _published_at_string(value)
    meta_date = _meta_content(
        soup,
        "article:published_time",
        "article:modified_time",
        "og:updated_time",
    )
    if meta_date:
        return _published_at_string(meta_date)
    return lastmod.isoformat() if lastmod else ""


def _extract_recipe_row_from_page(
    page_url: str,
    html_text: str,
    lastmod: datetime | None = None,
) -> dict | None:
    if not html_text:
        return None
    soup = BeautifulSoup(html_text, "html.parser")
    recipe = next(iter(_recipe_schema_objects(soup)), None)

    title = _first_schema_text(recipe.get("name") or recipe.get("headline")) if recipe else ""
    if not title:
        title = _title_from_page(soup)
    if not title:
        return None

    image_url = _first_schema_url(recipe.get("image"), page_url) if recipe else ""
    if not image_url and recipe:
        image_url = _first_schema_url(recipe.get("thumbnailUrl"), page_url)
    if not image_url:
        image_url = _image_from_page(soup, page_url)
    if not image_url:
        return None

    if not _is_recipe_like_page(soup, page_url, title, bool(recipe)):
        return None

    return {
        "image_url": image_url,
        "recipe_text": title,
        "post_url": page_url,
        "published_at": _published_at_from_recipe_page(recipe, soup, lastmod),
    }


def _dedupe_rows(rows: list[dict]) -> list[dict]:
    seen: set[tuple[str, str, str]] = set()
    deduped: list[dict] = []
    for row in rows:
        key = (
            _normalize_duplicate_url(str(row.get("post_url") or "")),
            str(row.get("image_url") or "").strip().lower(),
            _normalize_duplicate_title(str(row.get("recipe_text") or "")),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def _extract_same_domain_links_from_html(html_str: str, base_url: str) -> list[str]:
    if not html_str:
        return []
    soup = BeautifulSoup(html_str, "html.parser")
    links: list[str] = []
    seen: set[str] = set()
    for tag in soup.find_all("a", href=True):
        href = str(tag.get("href") or "").strip()
        candidate = urljoin(base_url + "/", href).split("#", 1)[0].rstrip("/")
        if not candidate or candidate in seen:
            continue
        if not _same_site_url(base_url, candidate) or _should_skip_page_url(candidate):
            continue
        seen.add(candidate)
        links.append(candidate)
        if len(links) >= _SITEMAP_PAGE_SCAN_LIMIT:
            break
    return links


async def _homepage_link_entries(
    base_url: str,
    client: httpx.AsyncClient,
    log: Callable[[str], None] | None = None,
) -> list[_SitemapEntry]:
    try:
        resp = await client.get(_origin_from_url(base_url))
    except Exception as exc:
        _log_scrape_diagnostic(log, f"homepage link crawl failed for {base_url}: {type(exc).__name__}")
        return []
    if resp.status_code != 200:
        _log_scrape_diagnostic(log, f"homepage link crawl returned status {resp.status_code} for {base_url}")
        return []
    return [_SitemapEntry(url) for url in _extract_same_domain_links_from_html(resp.text, _origin_from_url(base_url))]


async def _scrape_sitemap_pages(
    base_url: str,
    after: datetime | None,
    log: Callable[[str], None] | None = None,
) -> list[dict]:
    origin = _origin_from_url(base_url)
    parsed = urlparse(base_url)
    direct_entries = []
    if parsed.path and parsed.path.strip("/") and not _should_skip_page_url(base_url):
        direct_entries.append(_SitemapEntry(base_url))

    rows: list[dict] = []
    checked = 0
    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True) as client:
        entries = direct_entries + await _discover_sitemap_entries(origin, client, after, log)
        if not entries:
            entries = await _homepage_link_entries(origin, client, log)
        if not entries:
            _log_scrape_diagnostic(log, f"sitemap/page fallback found no candidate pages for {origin}")
            return []

        for entry in list({entry.url: entry for entry in entries}.values())[:_SITEMAP_PAGE_SCAN_LIMIT]:
            try:
                resp = await client.get(entry.url)
            except Exception as exc:
                _log_scrape_diagnostic(log, f"page fetch failed for {entry.url}: {type(exc).__name__}")
                continue
            checked += 1
            content_type = resp.headers.get("content-type", "").lower()
            if resp.status_code != 200:
                _log_scrape_diagnostic(log, f"page fetch returned status {resp.status_code} for {entry.url}")
                continue
            if content_type and "html" not in content_type and "text/plain" not in content_type:
                continue
            row = _extract_recipe_row_from_page(entry.url, resp.text, entry.lastmod)
            if not row:
                continue
            if after:
                published = _parse_any_datetime(row.get("published_at"))
                if published and published <= after:
                    continue
            rows.append(row)
            if len(rows) >= 50:
                break

    _log_scrape_diagnostic(log, f"sitemap/page fallback found {len(rows)} row(s) after checking {checked} page(s) for {origin}")
    return _dedupe_rows(rows)


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


def _published_at_from_wp_post(post: dict) -> str:
    """Return a normalized UTC publish timestamp when WordPress provides one."""
    raw = str(post.get("date_gmt") or post.get("date") or "").strip()
    if not raw or raw.startswith("0000-"):
        return ""
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    except ValueError:
        return raw


def _parse_rss_datetime(raw: str | None) -> datetime | None:
    """Parse RSS/Atom date formats and normalize them to UTC."""
    if not raw:
        return None
    value = raw.strip()
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _rss_item_published_at(item, namespaces: dict[str, str]) -> datetime | None:
    """Read the common RSS publication-date fields from one feed item."""
    for tag in ("pubDate", "dc:date", "published", "updated"):
        element = item.find(tag, namespaces) if tag.startswith("dc:") else item.find(tag)
        if element is not None:
            parsed = _parse_rss_datetime(element.text)
            if parsed is not None:
                return parsed
    return None


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
            results.append(
                {
                    "image_url": image_url,
                    "recipe_text": title,
                    "post_url": str(post.get("link") or "").strip(),
                    "published_at": _published_at_from_wp_post(post),
                }
            )

    return results


async def _scrape_rss(base_url: str, after: datetime | None) -> list[dict]:
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
        published_at = _rss_item_published_at(item, ns)
        if after and published_at and published_at <= after:
            continue

        title_el = item.find("title")
        title = html.unescape(title_el.text or "").strip() if title_el is not None else ""
        if not title:
            continue

        link_el = item.find("link")
        post_url = html.unescape(link_el.text or "").strip() if link_el is not None else ""
        if not post_url:
            guid_el = item.find("guid")
            candidate = html.unescape(guid_el.text or "").strip() if guid_el is not None else ""
            post_url = candidate if candidate.startswith(("http://", "https://")) else ""

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
            results.append(
                {
                    "image_url": image_url,
                    "recipe_text": title,
                    "post_url": post_url,
                    "published_at": published_at.isoformat() if published_at else "",
                }
            )

    return sorted(results, key=lambda row: row.get("published_at", ""), reverse=True)


async def scrape_source_rows(
    url: str,
    after: datetime | None,
    *,
    seed_when_empty: bool = False,
    log: Callable[[str], None] | None = None,
) -> list[dict]:
    base_url = _normalize_url(url)
    try:
        rows = await _scrape_wp_rest(base_url, after)
        if rows:
            _log_scrape_diagnostic(log, f"WordPress REST scrape found {len(rows)} row(s) for {base_url}")
            return _dedupe_rows(rows)
        _log_scrape_diagnostic(log, f"WordPress REST scrape found no rows for {base_url}")
    except Exception as exc:
        _log_scrape_diagnostic(log, f"WordPress REST scrape failed for {base_url}: {type(exc).__name__}")
    try:
        rows = await _scrape_rss(base_url, after)
        if rows:
            _log_scrape_diagnostic(log, f"RSS scrape found {len(rows)} row(s) for {base_url}")
            return _dedupe_rows(rows)
        _log_scrape_diagnostic(log, f"RSS scrape found no rows for {base_url}")
    except Exception as exc:
        _log_scrape_diagnostic(log, f"RSS scrape failed for {base_url}: {type(exc).__name__}")

    try:
        rows = await _scrape_sitemap_pages(base_url, after, log)
        if rows:
            return rows
    except Exception as exc:
        _log_scrape_diagnostic(log, f"sitemap/page fallback failed for {base_url}: {type(exc).__name__}")

    if seed_when_empty and after is not None:
        _log_scrape_diagnostic(
            log,
            f"No recent scrape rows for {base_url}; sampling latest sitemap recipe pages instead",
        )
        try:
            return await _scrape_sitemap_pages(base_url, None, log)
        except Exception as exc:
            _log_scrape_diagnostic(log, f"latest sitemap seed failed for {base_url}: {type(exc).__name__}")

    return []


def _make_empty_sheet_data(rows: int = 50, cols: int = 10) -> dict:
    return {"cells": {}, "colWidths": {}, "rowHeights": {}, "rows": rows, "cols": cols}


def _make_sheet_tab(tab_id: str, name: str, include_source_metadata: bool = False) -> dict:
    data = _make_empty_sheet_data()
    headers = _SOURCE_METADATA_HEADERS if include_source_metadata else _SOURCE_METADATA_HEADERS[:2]
    for column, header in enumerate(headers):
        data["cells"][f"0_{column}"] = {"v": header}
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


def _ensure_source_metadata_columns(tab: dict) -> None:
    """Add identity columns to existing Auto Spy tabs without changing their rows."""
    data = tab["data"]
    cells: dict = data.setdefault("cells", {})
    for column, header in enumerate(_SOURCE_METADATA_HEADERS):
        key = f"0_{column}"
        if not (cells.get(key, {}).get("v") or "").strip():
            cells[key] = {"v": header}
    data["cols"] = max(data.get("cols", 10), len(_SOURCE_METADATA_HEADERS))


def _normalize_duplicate_title(value: str) -> str:
    text = html.unescape(value)
    text = re.sub(r"<[^>]+>", " ", text)
    return " ".join(text.lower().split())


def _normalize_duplicate_url(value: str) -> str:
    return value.strip().rstrip("/").lower()


def _existing_row_identities_in_tab(workbook: dict, tab_id: str) -> tuple[set[str], set[str], set[str]]:
    """Return existing image URLs, source URLs, and normalized titles for a tab."""
    tab = next((s for s in workbook.get("sheets", []) if s["id"] == tab_id), None)
    if tab is None:
        return set(), set(), set()
    cells = tab["data"].get("cells", {})
    urls: set[str] = set()
    post_urls: set[str] = set()
    titles: set[str] = set()
    for key, cell in cells.items():
        row, separator, column = key.partition("_")
        if not separator or row == "0" or not isinstance(cell, dict):
            continue
        value = str(cell.get("v") or "").strip()
        if not value:
            continue
        if column == "0":
            urls.add(value)
        elif column == "1":
            title = _normalize_duplicate_title(value)
            if title:
                titles.add(title)
        elif column == "2":
            post_url = _normalize_duplicate_url(value)
            if post_url:
                post_urls.add(post_url)
    return urls, post_urls, titles


def _existing_urls_in_tab(workbook: dict, tab_id: str) -> set[str]:
    """Return the set of image_url values already stored in a sheet tab."""
    urls, _, _ = _existing_row_identities_in_tab(workbook, tab_id)
    return urls


def _append_rows_to_tab(
    workbook: dict,
    tab_id: str,
    rows: list[dict],
    track_source_identity: bool = False,
) -> int:
    """Append *rows* to the tab (skipping duplicates). Returns number of new rows added."""
    tab = next((s for s in workbook.get("sheets", []) if s["id"] == tab_id), None)
    if tab is None:
        return 0

    if track_source_identity:
        _ensure_source_metadata_columns(tab)

    cells: dict = tab["data"].get("cells", {})
    existing_urls, existing_post_urls, existing_titles = _existing_row_identities_in_tab(workbook, tab_id)

    occupied_rows = {int(k.split("_")[0]) for k in cells if "_" in k}
    next_row = max(occupied_rows, default=0) + 1

    added = 0
    for item in rows:
        img = item.get("image_url", "").strip()
        post_url = item.get("post_url", "").strip()
        title = item.get("recipe_text", "")
        post_url_key = _normalize_duplicate_url(post_url)
        title_key = _normalize_duplicate_title(title)
        duplicate = (
            not img
            or img in existing_urls
            or (track_source_identity and post_url_key and post_url_key in existing_post_urls)
            or (track_source_identity and title_key and title_key in existing_titles)
        )
        if duplicate:
            continue
        cells[f"{next_row}_0"] = {"v": img}
        cells[f"{next_row}_1"] = {"v": title}
        if track_source_identity:
            cells[f"{next_row}_2"] = {"v": post_url}
            cells[f"{next_row}_3"] = {"v": item.get("published_at", "")}
        existing_urls.add(img)
        if post_url_key:
            existing_post_urls.add(post_url_key)
        if title_key:
            existing_titles.add(title_key)
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

    Only articles published within the last 30 days are fetched. Each scan keeps
    the newest 10 candidates, and manual scans use the same window as the scheduler.
    """
    async with SessionLocal() as db:
        result = await db.execute(select(AutoSpySource).where(AutoSpySource.id == source_id))
        source = result.scalar_one_or_none()
        if source is None:
            return

        lookback_start = datetime.now(timezone.utc) - timedelta(days=_AUTO_SPY_LOOKBACK_DAYS)

        if force:
            after = lookback_start
        else:
            # Scheduler: use last_scanned_at but never go further back than the lookback window.
            after = max(source.last_scanned_at, lookback_start) if source.last_scanned_at else lookback_start

        rows = (
            await scrape_source_rows(
                source.url,
                after,
                seed_when_empty=force or source.last_scanned_at is None,
            )
        )[:_MAX_POSTS_PER_SCAN]

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
        _append_rows_to_tab(workbook, source.sheet_tab_id, rows, track_source_identity=True)

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
