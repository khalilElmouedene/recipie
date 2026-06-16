"""
Standalone runner for the `auto_spy_generate` job type.

This module is intentionally separate from the existing articles / publisher /
articles_all_sites flows so that changes here cannot affect those pipelines.

Flow:
  1. Distribute selected (image_url, recipe_text) pairs across all project sites
     (same fan-out as articles_all_sites).
  2. Generate articles for each recipe using article_generator.generate_for_recipe.
  3. Render a pin image for each recipe using the site's configured pin_template_id.
  4. After everything is done, upsert ProjectPublishSchedule so the publish
     scheduler picks up the generated recipes automatically.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import random
import re as _re
import tempfile
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Any, Callable

from sqlalchemy import select, update

from ..database import SessionLocal
from ..db_models import (
    Job as JobModel,
    JobLog,
    JobStatus,
    JobType,
    PinDesignerTemplate,
    ProjectPublishSchedule,
    Recipe,
    RecipeStatus,
    Site,
    SitePublishSchedule,
)


def _random_delay(log: Callable, min_sec: float = 4, max_sec: float = 9) -> None:
    delay = random.uniform(min_sec, max_sec)
    log(f"Waiting {delay:.2f}s before next request...")
    time.sleep(delay)


# ── Google Fonts download & caching ───────────────────────────────────────────

_FONT_CACHE_DIR = os.path.join(tempfile.gettempdir(), "pin_renderer_fonts")

_NATIVE_FONTS = frozenset({
    "arial", "helvetica", "sans-serif", "serif", "monospace",
    "times new roman", "courier new", "georgia", "verdana",
    "tahoma", "trebuchet ms", "impact", "comic sans ms",
    # Linux/Docker system fonts installed in image
    "liberation sans", "liberation serif", "liberation mono",
    "dejavu sans", "dejavu serif", "dejavu sans mono",
    "freesans", "freeserif", "freemono",
    "nimbus sans", "nimbus roman", "urw bookman",
})

# Commercial / platform-only fonts → visually similar Google Fonts substitute.
# The key is lowercase(family name). The value is the Google Fonts family to
# embed instead so the renderer still produces a nice result.
_FONT_SIMILARITY_MAP: dict[str, str] = {
    # ── Adobe fonts ──────────────────────────────────────────────────────────
    "penumbra sans std":        "Raleway",
    "penumbra serif std":       "Cormorant Garamond",
    "penumbra half serif std":  "Cormorant",
    "myriad pro":               "Source Sans 3",
    "myriad":                   "Source Sans 3",
    "minion pro":               "Merriweather",
    "minion":                   "Merriweather",
    "adobe garamond pro":       "Cormorant Garamond",
    "adobe garamond":           "Cormorant Garamond",
    "adobe caslon pro":         "EB Garamond",
    "adobe caslon":             "EB Garamond",
    "trajan pro":               "Cinzel",
    "trajan":                   "Cinzel",
    "warnock pro":              "Playfair Display",
    "cronos pro":               "Lato",
    "arno pro":                 "EB Garamond",
    "kepler std":               "Playfair Display",
    "chaparral pro":            "Merriweather",
    "hypatia sans pro":         "Josefin Sans",
    "itc avant garde":          "Josefin Sans",
    "itc garamond":             "Cormorant Garamond",
    "itc franklin gothic":      "Barlow",
    "ff meta":                  "Nunito Sans",
    "ff din":                   "Barlow",
    "din":                      "Barlow",
    "din condensed":            "Barlow Condensed",
    "din next":                 "Barlow",
    # ── Windows-only fonts ───────────────────────────────────────────────────
    "segoe ui":                 "Inter",
    "segoe ui light":           "Inter",
    "segoe ui semibold":        "Inter",
    "calibri":                  "Carlito",
    "cambria":                  "Caladea",
    "candara":                  "Nunito",
    "corbel":                   "Cabin",
    "consolas":                 "Inconsolata",
    "constantia":               "Libre Baskerville",
    "franklin gothic medium":   "Barlow",
    "century gothic":           "Josefin Sans",
    "palatino linotype":        "IM Fell English",
    "book antiqua":             "IM Fell English",
    "garamond":                 "Cormorant Garamond",
    "perpetua":                 "Cormorant",
    # ── macOS-only fonts ─────────────────────────────────────────────────────
    "sf pro":                   "Inter",
    "sf pro display":           "Inter",
    "sf pro text":              "Inter",
    "sf compact":               "Inter",
    "new york":                 "Playfair Display",
    "helvetica neue":           "Inter",
    "helvetica":                "Inter",
    "gill sans":                "Raleway",
    "gill sans mt":             "Raleway",
    "optima":                   "Questrial",
    "avenir":                   "Nunito",
    "avenir next":              "Nunito",
    "avenir next condensed":    "Nunito",
    "futura":                   "Josefin Sans",
    "futura pt":                "Josefin Sans",
    "baskerville":              "Libre Baskerville",
    "hoefler text":             "EB Garamond",
    "american typewriter":      "Zilla Slab",
    "didot":                    "Playfair Display",
    "bodoni 72":                "Bodoni Moda",
    "bodoni":                   "Bodoni Moda",
    "zapf chancery":            "Great Vibes",
    # ── Common licensed web fonts ────────────────────────────────────────────
    "gotham":                   "Montserrat",
    "gotham bold":              "Montserrat",
    "gotham narrow":            "Barlow Condensed",
    "proxima nova":             "Nunito Sans",
    "proxima nova alt":         "Nunito Sans",
    "brandon grotesque":        "Raleway",
    "brandon text":             "Lato",
    "neutraface":               "Josefin Sans",
    "neutraface condensed":     "Josefin Sans",
    "freight sans":             "Source Sans 3",
    "freight text":             "Source Serif 4",
    "freight display":          "Playfair Display",
    "museo sans":               "Nunito",
    "museo slab":               "Zilla Slab",
    "circular":                 "Nunito",
    "circular std":             "Nunito",
    "apercu":                   "DM Sans",
    "maison neue":              "DM Sans",
    "aktiv grotesk":            "Inter",
    "knockout":                 "Bebas Neue",
    "tungsten":                 "Bebas Neue",
    "miller display":           "Playfair Display",
    "chronicle display":        "Playfair Display",
    "chronicle text":           "Merriweather",
    "mercury":                  "EB Garamond",
    "archer":                   "Arvo",
    "sentinel":                 "Arvo",
    "ideal sans":               "Nunito",
    "verlag":                   "Josefin Sans",
    "operator mono":            "JetBrains Mono",
    "calibre":                  "Nunito Sans",
    "national":                 "Nunito",
    "tiempos":                  "Lora",
    "tiempos text":             "Lora",
    "graphik":                  "Inter",
    "canela":                   "Cormorant",
    "domaine display":          "Playfair Display",
    "founders grotesk":         "Barlow",
    "styrene":                  "Barlow",
    "atlas grotesk":            "DM Sans",
    "druk":                     "Bebas Neue",
    "druk wide":                "Bebas Neue",
    "portrait":                 "Playfair Display",
    "publico":                  "Lora",
    "le monde":                 "Lora",
    "exchange":                 "Merriweather",
    "scala sans":               "Source Sans 3",
    "scala":                    "Source Serif 4",
    "frutiger":                 "Nunito Sans",
    "univers":                  "Source Sans 3",
    "trade gothic":             "Barlow",
    "trade gothic next":        "Barlow",
    "helvetica world":          "Inter",
    "neue helvetica":           "Inter",
    "akzidenz grotesk":         "Inter",
    "folio":                    "Barlow",
    "eurostile":                "Rajdhani",
    "ocr a":                    "Share Tech Mono",
    "lucida grande":            "Nunito",
    "lucida sans":              "Nunito",
}


def _resolve_font_family(family: str) -> tuple[str, bool]:
    """Return (resolved_family, was_substituted).

    If *family* is a known commercial / platform-only font that can't be
    downloaded freely, return a visually similar Google Fonts alternative.
    Otherwise return *family* unchanged.
    """
    if not family:
        return family, False
    sub = _FONT_SIMILARITY_MAP.get(family.lower().strip())
    if sub:
        return sub, True
    return family, False


def _download_google_font(family: str, bold: bool, italic: bool) -> str | None:
    """Fetch a Google Font TTF (for PIL), cache to disk, return local path or None."""
    import requests as _req
    try:
        os.makedirs(_FONT_CACHE_DIR, exist_ok=True)
        safe = _re.sub(r"[^a-z0-9]", "_", family.lower().strip())
        tag = ("b" if bold else "") + ("i" if italic else "") or "r"
        cache = os.path.join(_FONT_CACHE_DIR, f"{safe}_{tag}.ttf")
        if os.path.exists(cache):
            return cache
        weight = "700" if bold else "400"
        ital_str = "italic" if italic else ""
        q = family.strip().replace(" ", "+")
        url = f"https://fonts.googleapis.com/css?family={q}:{weight}{ital_str}"
        r = _req.get(url, headers={"User-Agent": "Mozilla/4.0 (compatible; MSIE 8.0)"}, timeout=8)
        m = _re.search(r"url\(([^)]+\.ttf)\)", r.text)
        if m:
            font_url = m.group(1).strip("'\"")
            r2 = _req.get(font_url, timeout=15)
            r2.raise_for_status()
            with open(cache, "wb") as fh:
                fh.write(r2.content)
            return cache
    except Exception:
        pass
    return None


def _download_google_font_woff2(family: str, bold: bool, italic: bool) -> str | None:
    """Fetch a Google Font as WOFF2 (for Playwright/Chrome), cache to disk, return path or None."""
    import requests as _req
    try:
        os.makedirs(_FONT_CACHE_DIR, exist_ok=True)
        safe = _re.sub(r"[^a-z0-9]", "_", family.lower().strip())
        tag = ("b" if bold else "") + ("i" if italic else "") or "r"
        cache = os.path.join(_FONT_CACHE_DIR, f"{safe}_{tag}.woff2")
        if os.path.exists(cache):
            return cache
        weight = "700" if bold else "400"
        ital = "1" if italic else "0"
        encoded = family.strip().replace(" ", "+")
        # CSS2 API with modern Chrome UA → Google always serves WOFF2
        css_url = (
            f"https://fonts.googleapis.com/css2?family={encoded}"
            f":ital,wght@{ital},{weight}&display=swap"
        )
        chrome_ua = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
        r = _req.get(css_url, headers={"User-Agent": chrome_ua}, timeout=10)
        r.raise_for_status()
        # Google returns multiple @font-face blocks (one per unicode range subset).
        # The LAST block is always the Latin subset (U+0000-00FF) which covers English.
        # Using the first match would give Cyrillic/CJK — wrong for English text.
        matches = _re.findall(r"url\(([^)]+\.woff2)\)", r.text)
        if matches:
            font_url = matches[-1].strip("'\"")
            r2 = _req.get(font_url, timeout=15)
            r2.raise_for_status()
            with open(cache, "wb") as fh:
                fh.write(r2.content)
            return cache
    except Exception:
        pass
    return None


def _elem_font(elem: dict, log: Callable[[str], None]):
    """Return the closest available PIL font for a template text element."""
    from PIL import ImageFont
    from ..services.pin_generator import _font as _sys_font

    # In the template's saved format, fontSize is already the correct pixel size
    # (scaleX/scaleY are baked into width/height, not stored separately)
    size = max(8, int(float(elem.get("fontSize", 36))))
    family = str(elem.get("fontFamily") or "").strip()
    weight = str(elem.get("fontWeight") or "normal")
    style = str(elem.get("fontStyle") or "normal").lower()

    bold = (weight.isdigit() and int(weight) >= 700) or (not weight.isdigit() and weight.lower() in ("bold", "bolder"))
    italic = "italic" in style

    if family and family.lower() not in _NATIVE_FONTS:
        resolved, substituted = _resolve_font_family(family)
        if substituted:
            log(f"  Font '{family}' → substituting '{resolved}'")
        for candidate in ([resolved] if substituted else [family]):
            for b, i in [(bold, italic), (bold, False), (False, False)]:
                path = _download_google_font(candidate, b, i)
                if path:
                    try:
                        return ImageFont.truetype(path, size)
                    except Exception:
                        pass
        log(f"  Font '{family}' unavailable, using system fallback")
    return _sys_font(size, bold)


# ── Pin image rendering ────────────────────────────────────────────────────────

def _image_source_mode(elem: dict) -> str:
    return "random" if elem.get("imageSource") == "random" else "original"


def _stable_image_index(seed: str, length: int) -> int:
    if length <= 1:
        return 0
    digest = hashlib.sha256(seed.encode("utf-8", errors="ignore")).digest()
    return int.from_bytes(digest[:8], "big") % length


def _image_urls_from_json(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(url).strip() for url in parsed if str(url or "").strip()]


def _other_site_pin_images(items: list[dict], per_item_images: dict[str, str], current_item_id: str) -> list[str]:
    images: list[str] = []
    for other in items:
        other_id = str(other.get("id") or "")
        if not other_id or other_id == current_item_id:
            continue
        images.extend(_image_urls_from_json(per_item_images.get(other_id)))
    return images


def _render_pin_for_recipe(
    image_url: str,
    title: str,
    pin_template_id: str | None,
    site_domain: str,
    log: Callable[[str], None],
    random_image_urls: list[str] | None = None,
    main_loop: asyncio.AbstractEventLoop | None = None,
) -> str | None:
    """Return a base64 data-URI for the pin image, or None on failure."""
    from ..services.pin_generator import generate_pin_base64, TEMPLATES

    try:
        if pin_template_id and pin_template_id in TEMPLATES:
            b64 = generate_pin_base64(
                template_id=pin_template_id,
                image_urls=[image_url],
                title=title,
                website=site_domain,
            )
            return b64

        if pin_template_id:
            b64 = _render_custom_template_sync(
                pin_template_id,
                image_url,
                title,
                site_domain,
                log,
                random_image_urls=random_image_urls,
                main_loop=main_loop,
            )
            if b64:
                return b64

        # Fallback: modern_split built-in
        b64 = generate_pin_base64(
            template_id="modern_split",
            image_urls=[image_url],
            title=title,
            website=site_domain,
        )
        return b64
    except Exception as exc:
        log(f"Pin rendering failed (non-fatal): {exc}")
        return None


def _render_custom_template_sync(
    template_id: str,
    image_url: str,
    title: str,
    site_domain: str,
    log: Callable[[str], None],
    random_image_urls: list[str] | None = None,
    main_loop: asyncio.AbstractEventLoop | None = None,
) -> str | None:
    """Render a PinDesignerTemplate from the DB.

    Tries Playwright (headless Chromium, pixel-perfect) first, then
    falls back to PIL for simpler templates or when Playwright is absent.
    """

    async def _load():
        async with SessionLocal() as session:
            try:
                row = await session.execute(
                    select(PinDesignerTemplate).where(
                        PinDesignerTemplate.id == uuid.UUID(template_id)
                    )
                )
                return row.scalar_one_or_none()
            except Exception:
                return None

    # Always run on the main event loop to avoid leaking asyncpg connections.
    # asyncio.run() would create a new loop in this thread, corrupting the pool.
    try:
        if main_loop is not None and main_loop.is_running():
            tmpl = asyncio.run_coroutine_threadsafe(_load(), main_loop).result(timeout=15)
        else:
            tmpl = asyncio.run(_load())
    except Exception:
        return None

    if tmpl is None:
        return None

    try:
        elements = json.loads(tmpl.elements_json) if tmpl.elements_json else []
    except Exception:
        elements = []

    bg_color = tmpl.bg_color or "#ffffff"
    canvas_width = tmpl.canvas_width or 1000
    canvas_height = tmpl.canvas_height or 1500

    # Try Playwright first for pixel-perfect rendering
    pw_result = _render_with_playwright_sync(
        elements=elements,
        bg_color=bg_color,
        canvas_width=canvas_width,
        canvas_height=canvas_height,
        image_url=image_url,
        random_image_urls=random_image_urls or [],
        title=title,
        site_domain=site_domain,
        log=log,
    )
    if pw_result:
        return pw_result

    # Fall back to PIL
    log("  Playwright unavailable — falling back to PIL renderer")
    return _pil_render_elements(
        elements=elements,
        bg_color=bg_color,
        canvas_width=canvas_width,
        canvas_height=canvas_height,
        image_url=image_url,
        random_image_urls=random_image_urls or [],
        title=title,
        site_domain=site_domain,
        log=log,
    )


def _parse_hex_color(color: str, opacity: float = 1.0) -> tuple:
    """Parse a CSS hex or rgb color into an RGBA tuple."""
    color = (color or "#888888").strip()
    a = max(0, min(255, int(opacity * 255)))
    try:
        if color.startswith("#"):
            h = color.lstrip("#")
            if len(h) == 3:
                h = h[0]*2 + h[1]*2 + h[2]*2
            r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            return (r, g, b, a)
        if color.startswith("rgb"):
            parts = color.replace("rgba(", "").replace("rgb(", "").replace(")", "")
            nums = [float(x.strip()) for x in parts.split(",")]
            r, g, b = int(nums[0]), int(nums[1]), int(nums[2])
            return (r, g, b, a)
    except Exception:
        pass
    return (136, 136, 136, a)


def _pil_wrap_lines(text: str, max_w: int, font: Any) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        test = f"{cur} {word}".strip()
        bbox = font.getbbox(test)
        bw = bbox[2] - bbox[0]
        if bw <= max_w or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def _pil_line_height(font: Any, spacing: float) -> int:
    bbox = font.getbbox("Ayg")
    return max(1, int((bbox[3] - bbox[1]) * spacing))


def _pil_draw_wrapped_lines(
    draw: Any,
    lines: list[str],
    x: int,
    y: int,
    max_w: int,
    font: Any,
    color: Any,
    line_height: int,
    align: str,
) -> None:
    for idx, line in enumerate(lines):
        bbox = font.getbbox(line)
        lw = bbox[2] - bbox[0]
        if align == "center":
            lx = x + (max_w - lw) // 2
        elif align == "right":
            lx = x + max_w - lw
        else:
            lx = x
        draw.text((lx, y + idx * line_height), line, fill=color, font=font)


def _url_to_data_uri(url: str, log: Callable[[str], None]) -> str | None:
    """Download *url* and return it as a base64 data URI, or None on failure.
    If the URL is already a data URI it is returned as-is.
    """
    if url.startswith("data:"):
        return url  # already a data URI — pass through directly
    try:
        import requests as _req
        r = _req.get(url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        ctype = (r.headers.get("content-type", "image/jpeg").split(";")[0].strip()
                 or "image/jpeg")
        return f"data:{ctype};base64,{base64.b64encode(r.content).decode()}"
    except Exception as exc:
        log(f"  Data URI fetch failed ({url[:60]}): {exc}")
        return None


def _font_to_data_uri(family: str, bold: bool, italic: bool) -> tuple[str, str] | None:
    """Return (data_uri, format_hint) for the font, or None if unavailable.

    Prefers WOFF2 (Chrome UA, always served by Google) over TTF (old IE UA).
    """
    # WOFF2 first — guaranteed from Google Fonts with a modern UA
    path = _download_google_font_woff2(family, bold, italic)
    if path and os.path.exists(path):
        with open(path, "rb") as fh:
            return f"data:font/woff2;base64,{base64.b64encode(fh.read()).decode()}", "woff2"
    # TTF fallback (legacy IE UA download)
    path = _download_google_font(family, bold, italic)
    if path and os.path.exists(path):
        with open(path, "rb") as fh:
            return f"data:font/truetype;base64,{base64.b64encode(fh.read()).decode()}", "truetype"
    return None


def _build_pin_render_html(
    elements: list[dict],
    bg_color: str,
    canvas_width: int,
    canvas_height: int,
    food_data_uri: str,
    random_food_data_uris: list[str],
    asset_data_uris: dict[str, str],
    title: str,
    site_domain: str = "",
    log: Callable[[str], None] | None = None,
) -> str:
    """Build a self-contained HTML page that renders the pin template on a <canvas>."""
    _log = log or (lambda _: None)

    # Build a font-family substitution map: original → resolved (free) name.
    # This must happen BEFORE building the elements JSON so the JavaScript
    # ctx.font string and the FontFace loader use the same resolved name.
    family_map: dict[str, str] = {}
    for elem in elements:
        if elem.get("type") == "text":
            fam = str(elem.get("fontFamily") or "").strip()
            if fam and fam not in family_map:
                resolved, substituted = _resolve_font_family(fam)
                family_map[fam] = resolved
                if substituted:
                    _log(f"  Font substitution: '{fam}' → '{resolved}'")

    # Rewrite elements so the JS sees the resolved font name in elem.fontFamily
    elements = [
        {**e, "fontFamily": family_map.get(str(e.get("fontFamily") or "").strip(),
                                           str(e.get("fontFamily") or "").strip())}
        if e.get("type") == "text" else e
        for e in elements
    ]

    # Collect non-native font families (resolved names) used by text elements
    font_families: set[str] = set()
    for elem in elements:
        if elem.get("type") == "text":
            fam = str(elem.get("fontFamily") or "").strip()
            if fam and fam.lower() not in _NATIVE_FONTS:
                font_families.add(fam)

    # Build JS FontFace loading code — more reliable than CSS @font-face in headless Chrome.
    # The FontFace API lets us explicitly await each font before drawing anything.
    font_load_js = ""
    for fam in sorted(font_families):
        _log(f"  Embedding font: {fam}")
        fam_esc = fam.replace("\\", "\\\\").replace('"', '\\"')
        for bold, italic, weight, css_style in [
            (False, False, "400", "normal"),
            (True,  False, "700", "normal"),
            (False, True,  "400", "italic"),
            (True,  True,  "700", "italic"),
        ]:
            result = _font_to_data_uri(fam, bold, italic)
            if result:
                uri, fmt = result
                # Use single quotes around the data URI so it doesn't need escaping
                font_load_js += (
                    f"  try {{\n"
                    f"    const _ff = new FontFace(\"{fam_esc}\", \"url('{uri}')\","
                    f" {{weight:\"{weight}\",style:\"{css_style}\"}});\n"
                    f"    document.fonts.add(_ff);\n"
                    f"    await _ff.load();\n"
                    f"  }} catch(_e) {{}}\n"
                )
                _log(f"    {weight} {css_style} → {fmt} embedded ({len(uri)//1024}KB)")
            else:
                _log(f"    {weight} {css_style} → FAILED to download")

    random_food_imgs = "".join(
        f'<img id="food_random_{idx}" src="{uri}" style="display:none">\n'
        for idx, uri in enumerate(random_food_data_uris)
    )
    random_food_ids_json = json.dumps([f"food_random_{idx}" for idx in range(len(random_food_data_uris))])

    # Hidden <img> elements for asset images (data URIs avoid canvas CORS taint)
    asset_id_map: dict[str, str] = {}
    asset_imgs = ""
    for elem in elements:
        if elem.get("type") == "asset":
            url = str(elem.get("imageUrl") or "")
            if url and url in asset_data_uris and url not in asset_id_map:
                eid = f"asset_{len(asset_id_map)}"
                asset_id_map[url] = eid
                asset_imgs += f'<img id="{eid}" src="{asset_data_uris[url]}" style="display:none">\n'

    # Inject __assetId so JS can look up the <img> element
    elements_tagged = []
    for elem in elements:
        e = dict(elem)
        if e.get("type") == "asset":
            e["__assetId"] = asset_id_map.get(str(e.get("imageUrl") or ""), "")
        elements_tagged.append(e)

    elems_json = json.dumps(elements_tagged, ensure_ascii=False)
    title_json = json.dumps(title, ensure_ascii=False)
    website_json = json.dumps(site_domain, ensure_ascii=False)
    bg_json = json.dumps(bg_color)

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* {{ margin: 0; padding: 0; }}
body {{ background: #000; overflow: hidden; width: {canvas_width}px; height: {canvas_height}px; }}
canvas {{ display: block; }}
</style>
</head>
<body>
<canvas id="c" width="{canvas_width}" height="{canvas_height}"></canvas>
<img id="food" src="{food_data_uri}" style="display:none">
{random_food_imgs}
{asset_imgs}
<script>
const ELEMENTS = {elems_json};
const TITLE = {title_json};
const WEBSITE = {website_json};
const BG = {bg_json};
const W = {canvas_width};
const H = {canvas_height};
const RANDOM_FOOD_IDS = {random_food_ids_json};

function stableHash(value) {{
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {{
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }}
  return hash >>> 0;
}}

function pickFoodImage(elem, imageIndex) {{
  if (elem.imageSource === 'random' && RANDOM_FOOD_IDS.length > 0) {{
    const idx = stableHash(`${{TITLE}}:${{WEBSITE}}:${{elem.id || ''}}:${{imageIndex}}`) % RANDOM_FOOD_IDS.length;
    return document.getElementById(RANDOM_FOOD_IDS[idx]) || document.getElementById('food');
  }}
  return document.getElementById('food');
}}

function drawCover(ctx, img, dx, dy, dw, dh, flipX) {{
  if (!img || !img.naturalWidth) return;
  const ratio = Math.max(dw / img.naturalWidth, dh / img.naturalHeight);
  const sw = dw / ratio, sh = dh / ratio;
  const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(dx, dy, dw, dh); ctx.clip();
  if (flipX) {{
    ctx.translate(dx + dw, dy); ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  }} else {{
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }}
  ctx.restore();
}}

function wrapLines(ctx, text, maxW) {{
  if (!text) return;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {{
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {{
      lines.push(line); line = words[i];
    }} else {{ line = test; }}
  }}
  if (line) lines.push(line);
  return lines;
}}

function drawWrappedText(ctx, text, x, centerY, maxW, lh) {{
  const lines = wrapLines(ctx, text, maxW) || [];
  if (!lines.length) return;
  const metrics = ctx.measureText('Ayg');
  const glyphH = Math.max(1, (metrics.actualBoundingBoxAscent || lh * 0.78) + (metrics.actualBoundingBoxDescent || lh * 0.22));
  const totalH = glyphH + Math.max(0, lines.length - 1) * lh;
  const startY = centerY - totalH / 2;
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, startY + i * lh);
}}

async function render() {{
  // Load each font via the FontFace API — awaited before drawing.
  // This is the only reliable way to use custom fonts in headless Chrome canvas.
{font_load_js}
  await document.fonts.ready;
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const food = document.getElementById('food');

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  let imageIndex = 0;
  for (const elem of ELEMENTS) {{
    const t = elem.type || '';
    const ex = elem.x || 0, ey = elem.y || 0;
    const ew = elem.width || 100, eh = elem.height || 100;

    if (t === 'band') {{
      ctx.fillStyle = elem.bgColor || '#888';
      ctx.fillRect(ex, ey, ew, eh);
    }}
    else if (t === 'frame') {{
      ctx.save();
      ctx.strokeStyle = elem.fill || '#fff';
      ctx.lineWidth = elem.strokeWidth || 2;
      if (elem.strokeStyle === 'dashed') ctx.setLineDash([10, 6]);
      else if (elem.strokeStyle === 'dotted') ctx.setLineDash([3, 6]);
      const r = elem.radius || 0;
      ctx.beginPath();
      if (r > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(ex, ey, ew, eh, r);
      else ctx.rect(ex, ey, ew, eh);
      ctx.stroke();
      ctx.restore();
    }}
    else if (t === 'image') {{
      drawCover(ctx, pickFoodImage(elem, imageIndex), ex, ey, ew, eh, !!elem.flipX);
      imageIndex += 1;
    }}
    else if (t === 'asset') {{
      const assetEl = elem.__assetId ? document.getElementById(elem.__assetId) : null;
      if (assetEl && assetEl.naturalWidth) {{
        ctx.save();
        ctx.beginPath(); ctx.rect(ex, ey, ew, eh); ctx.clip();
        if (elem.flipX || elem.flipY) {{
          ctx.translate(ex + ew / 2, ey + eh / 2);
          ctx.scale(elem.flipX ? -1 : 1, elem.flipY ? -1 : 1);
          ctx.drawImage(assetEl, -ew / 2, -eh / 2, ew, eh);
        }} else {{
          ctx.drawImage(assetEl, ex, ey, ew, eh);
        }}
        ctx.restore();
      }}
    }}
    else if (t === 'text') {{
      // x,y are CENTER coords (getCenterPoint() saved them that way)
      const lx = ex - ew / 2, ty = ey - eh / 2;
      let display;
      if (elem.textVariable === 'website' || elem.id === 'website') {{
        display = WEBSITE || elem.defaultText || TITLE;
      }} else if (elem.textVariable || !elem.defaultText) {{
        display = TITLE;
      }} else {{
        display = elem.defaultText || TITLE;
      }}
      if (!display) continue;
      const tt = (elem.textTransform || 'none').toLowerCase();
      if (tt === 'uppercase') display = display.toUpperCase();
      else if (tt === 'lowercase') display = display.toLowerCase();

      const fs = elem.fontSize || 36;
      const fam = elem.fontFamily || 'sans-serif';
      const fw = elem.fontWeight || 'normal';
      const fi = elem.fontStyle || 'normal';
      ctx.font = fi + ' ' + fw + ' ' + fs + 'px "' + fam + '", sans-serif';
      ctx.fillStyle = elem.fill || '#fff';
      const lh = (elem.lineHeight || 1.3) * fs;
      const align = (elem.textAlign || 'center').toLowerCase();
      if (align === 'center') {{
        ctx.textAlign = 'center';
        drawWrappedText(ctx, display, lx + ew / 2, ey, ew, lh);
      }} else if (align === 'right') {{
        ctx.textAlign = 'right';
        drawWrappedText(ctx, display, lx + ew, ey, ew, lh);
      }} else {{
        ctx.textAlign = 'left';
        drawWrappedText(ctx, display, lx, ey, ew, lh);
      }}
    }}
  }}
  window.__rendered = true;
}}

(function() {{
  const food = document.getElementById('food');
  if (food.complete && food.naturalWidth) {{ render(); }}
  else {{ food.onload = render; food.onerror = render; }}
}})();
</script>
</body>
</html>"""


def _render_with_playwright_sync(
    elements: list[dict],
    bg_color: str,
    canvas_width: int,
    canvas_height: int,
    image_url: str,
    random_image_urls: list[str],
    title: str,
    site_domain: str,
    log: Callable[[str], None],
) -> str | None:
    """Render the pin template in headless Chromium via Playwright.

    Returns a JPEG data URI, or None if Playwright is not installed or rendering fails.
    Falls back transparently — callers should try PIL on None.
    """
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
    except ImportError:
        return None

    log(f"  Rendering pin with Playwright — canvas {canvas_width}×{canvas_height}, bg={bg_color}")

    food_data_uri = _url_to_data_uri(image_url, log)
    if not food_data_uri:
        log("  Could not fetch food image — skipping Playwright render")
        return None

    random_food_data_uris = [
        data
        for data in (_url_to_data_uri(url, log) for url in random_image_urls if url and url != image_url)
        if data
    ]

    asset_data_uris: dict[str, str] = {}
    for elem in elements:
        if elem.get("type") == "asset":
            url = str(elem.get("imageUrl") or "")
            if url and url not in asset_data_uris:
                data = _url_to_data_uri(url, log)
                if data:
                    asset_data_uris[url] = data

    html = _build_pin_render_html(
        elements=elements,
        bg_color=bg_color,
        canvas_width=canvas_width,
        canvas_height=canvas_height,
        food_data_uri=food_data_uri,
        random_food_data_uris=random_food_data_uris,
        asset_data_uris=asset_data_uris,
        title=title,
        site_domain=site_domain,
        log=log,
    )

    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage"])
            page = browser.new_page(viewport={"width": canvas_width, "height": canvas_height})
            page.set_content(html, wait_until="domcontentloaded")
            page.wait_for_function("() => window.__rendered === true", timeout=30_000)
            data_url: str = page.evaluate(
                "() => document.getElementById('c').toDataURL('image/jpeg', 0.92)"
            )
            browser.close()
        if data_url and data_url.startswith("data:"):
            log("  Playwright render complete")
            return data_url
    except Exception as exc:
        log(f"  Playwright render error: {exc}")

    return None


def _pil_render_elements(
    elements: list[dict],
    bg_color: str,
    canvas_width: int,
    canvas_height: int,
    image_url: str,
    random_image_urls: list[str],
    title: str,
    site_domain: str,
    log: Callable[[str], None],
) -> str | None:
    try:
        from PIL import Image, ImageDraw
        from ..services.pin_generator import _download, _fit_crop, _placeholder
    except Exception as exc:
        log(f"PIL import failed: {exc}")
        return None

    try:
        bg_rgba = _parse_hex_color(bg_color)
        canvas = Image.new("RGBA", (canvas_width, canvas_height), bg_rgba)

        food_img: Image.Image | None = None
        random_food_cache: dict[str, Image.Image] = {}
        random_image_urls = [url for url in random_image_urls if url and url != image_url]

        def _get_food() -> Image.Image:
            nonlocal food_img
            if food_img is None:
                try:
                    food_img = _download(image_url)
                except Exception:
                    food_img = _placeholder(400, 600)
            return food_img

        def _get_random_food(elem: dict, image_index: int) -> Image.Image:
            if _image_source_mode(elem) != "random" or not random_image_urls:
                return _get_food()
            idx = _stable_image_index(f"{title}:{site_domain}:{elem.get('id', '')}:{image_index}", len(random_image_urls))
            url = random_image_urls[idx]
            if url not in random_food_cache:
                try:
                    random_food_cache[url] = _download(url)
                except Exception:
                    random_food_cache[url] = _get_food()
            return random_food_cache[url]

        def _paste(el_img: Image.Image, lx: int, ty: int) -> None:
            """Alpha-composite el_img onto canvas at (lx, ty), clamped to canvas bounds."""
            if el_img.mode != "RGBA":
                el_img = el_img.convert("RGBA")
            ox = max(0, -lx)
            oy = max(0, -ty)
            cw = min(el_img.width - ox, canvas_width - max(0, lx))
            ch = min(el_img.height - oy, canvas_height - max(0, ty))
            if cw <= 0 or ch <= 0:
                return
            canvas.alpha_composite(el_img.crop((ox, oy, ox + cw, oy + ch)), (max(0, lx), max(0, ty)))

        image_index = 0
        for elem in elements:
            # Template designer saves elements with a custom schema (not raw Fabric.js JSON):
            #   type     → "band" | "image" | "frame" | "text" | "asset"
            #   x, y     → top-left canvas coords for band/image/frame/asset
            #              CENTER canvas coords for text (getCenterPoint() was used)
            #   width, height → already scaled (no scaleX/scaleY needed)
            #   band:    bgColor = fill color
            #   frame:   fill = stroke color, strokeWidth, radius, strokeStyle
            #   image:   image zone (render food photo here), flipX
            #   asset:   static uploaded image, imageUrl, flipX, flipY
            #   text:    defaultText, textVariable, fill, fontFamily/Size/Weight/Style,
            #            textAlign, textTransform

            etype = str(elem.get("type") or "")
            ex = int(float(elem.get("x", 0)))
            ey = int(float(elem.get("y", 0)))
            w = max(1, int(float(elem.get("width", 100))))
            h = max(1, int(float(elem.get("height", 100))))

            log(f"  elem type={etype} x={ex} y={ey} w={w} h={h}")

            if etype == "band":
                fill = _parse_hex_color(str(elem.get("bgColor") or "#888888"))
                _paste(Image.new("RGBA", (w, h), fill), ex, ey)

            elif etype == "frame":
                el = Image.new("RGBA", (w, h), (0, 0, 0, 0))
                # In the saved format, stroke color is stored as "fill"
                stroke = _parse_hex_color(str(elem.get("fill") or "#ffffff"))
                sw = max(1, int(float(elem.get("strokeWidth", 2))))
                radius = int(float(elem.get("radius", 0)))
                d = ImageDraw.Draw(el)
                if radius > 0:
                    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, outline=stroke, width=sw)
                else:
                    d.rectangle([0, 0, w - 1, h - 1], outline=stroke, width=sw)
                _paste(el, ex, ey)

            elif etype == "image":
                # Image zone — render the scraped food photo here
                cropped = _fit_crop(_get_random_food(elem, image_index), w, h).convert("RGBA")
                image_index += 1
                if elem.get("flipX"):
                    cropped = cropped.transpose(Image.FLIP_LEFT_RIGHT)
                _paste(cropped, ex, ey)

            elif etype == "asset":
                # Static image uploaded by user into the template
                asset_url = str(elem.get("imageUrl") or "")
                if asset_url:
                    try:
                        import requests as _req2
                        r2 = _req2.get(asset_url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
                        r2.raise_for_status()
                        asset_img = Image.open(BytesIO(r2.content)).convert("RGBA")
                        asset_img = asset_img.resize((w, h), Image.LANCZOS)
                        if elem.get("flipX"):
                            asset_img = asset_img.transpose(Image.FLIP_LEFT_RIGHT)
                        if elem.get("flipY"):
                            asset_img = asset_img.transpose(Image.FLIP_TOP_BOTTOM)
                        _paste(asset_img, ex, ey)
                    except Exception as ae:
                        log(f"  Asset image failed: {ae}")

            elif etype == "text":
                # x,y are CENTER coordinates (saved via getCenterPoint())
                left_x = ex - w // 2
                top_y = ey - h // 2

                default_text = str(elem.get("defaultText") or "").strip()
                text_var = str(elem.get("textVariable") or "").strip()
                elem_id = str(elem.get("id") or "")
                if text_var == "website" or elem_id == "website":
                    display = site_domain or default_text or title
                elif text_var or not default_text:
                    display = title
                else:
                    display = default_text
                if not display:
                    continue

                # Apply textTransform
                tt = str(elem.get("textTransform") or "none").lower()
                if tt == "uppercase":
                    display = display.upper()
                elif tt == "lowercase":
                    display = display.lower()

                fill_color = _parse_hex_color(str(elem.get("fill") or "#ffffff"))
                font = _elem_font(elem, log)
                align = str(elem.get("textAlign", "center")).lower()
                if align not in ("left", "center", "right"):
                    align = "center"
                lh = float(elem.get("lineHeight", 1.3))
                lines = _pil_wrap_lines(display, w, font)
                if not lines:
                    continue
                line_height = _pil_line_height(font, lh)
                glyph_bbox = font.getbbox("Ayg")
                glyph_h = max(1, glyph_bbox[3] - glyph_bbox[1])
                total_text_h = glyph_h + max(0, len(lines) - 1) * line_height
                top_y = ey - total_text_h // 2

                el_h = max(1, total_text_h + line_height)
                el = Image.new("RGBA", (max(1, w), el_h), (0, 0, 0, 0))
                _pil_draw_wrapped_lines(ImageDraw.Draw(el), lines, 0, 0, w, font, fill_color, line_height, align)
                _paste(el, left_x, top_y)

        buf = BytesIO()
        canvas.convert("RGB").save(buf, format="JPEG", quality=90)
        return f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode()}"
    except Exception as exc:
        log(f"Custom template render error: {exc}")
        return None


# ── DB helpers (called from background thread via run_coroutine_threadsafe) ────

async def _db_update_recipe(recipe_id: str, fields: dict) -> None:
    async with SessionLocal() as session:
        row = await session.execute(select(Recipe).where(Recipe.id == uuid.UUID(recipe_id)))
        recipe = row.scalar_one_or_none()
        if not recipe:
            return
        for key, val in fields.items():
            if not hasattr(recipe, key) or val is None:
                continue
            if key == "pin_blog_link" and getattr(recipe, "pin_blog_link", None):
                continue
            setattr(recipe, key, val)
        if fields.get("error_message"):
            recipe.status = RecipeStatus.failed
        else:
            recipe.status = RecipeStatus.generated
            recipe.error_message = None
        await session.commit()


async def _db_mark_recipe_published(recipe_id: str, wp_post_id: str | None, wp_permalink: str | None) -> None:
    async with SessionLocal() as session:
        row = await session.execute(select(Recipe).where(Recipe.id == uuid.UUID(recipe_id)))
        recipe = row.scalar_one_or_none()
        if recipe:
            recipe.status = RecipeStatus.published
            recipe.wp_post_id = str(wp_post_id) if wp_post_id else None
            recipe.wp_permalink = wp_permalink
            recipe.error_message = None
            await session.commit()


def _publish_with_retry(
    recipe_data: dict,
    site_config: dict,
    post_date_gmt,
    log,
    site_obj,
    max_attempts: int = 3,
    retry_delay: float = 8.0,
) -> dict:
    """Call publish_recipe up to max_attempts times, rotating WP user on 401."""
    import time as _time
    from ..services.publisher import publish_recipe as _pub
    from ..site_credentials import get_random_wp_credentials as _get_creds

    result: dict = {"error_message": "No attempts made"}
    current_config = site_config
    for attempt in range(1, max_attempts + 1):
        try:
            result = _pub(recipe_data, current_config, post_date_gmt=post_date_gmt, log=log)
        except Exception as exc:
            result = {"error_message": str(exc)}
        if not result.get("error_message"):
            return result
        err = str(result["error_message"])
        if attempt < max_attempts:
            log(f"    Attempt {attempt}/{max_attempts} failed: {err[:120]} — retrying in {retry_delay:.0f}s…")
            if "401" in err or "not allowed to post" in err.lower():
                try:
                    wp_user, wp_pass = _get_creds(site_obj)
                    current_config = {**current_config, "wp_username": wp_user, "wp_password": wp_pass}
                    log(f"    Switching WP user to: {wp_user}")
                except Exception:
                    pass
            _time.sleep(retry_delay)
    return result


async def _db_mark_recipe_failed(recipe_id: str, error_message: str) -> None:
    async with SessionLocal() as session:
        row = await session.execute(select(Recipe).where(Recipe.id == uuid.UUID(recipe_id)))
        recipe = row.scalar_one_or_none()
        if recipe:
            recipe.status = RecipeStatus.failed
            recipe.error_message = error_message
            await session.commit()


async def _db_mark_recipe_publish_failed(recipe_id: str, error_message: str) -> None:
    async with SessionLocal() as session:
        row = await session.execute(select(Recipe).where(Recipe.id == uuid.UUID(recipe_id)))
        recipe = row.scalar_one_or_none()
        if recipe:
            recipe.status = RecipeStatus.generated if recipe.generated_article else RecipeStatus.failed
            recipe.error_message = f"Publishing failed: {error_message}"
            await session.commit()


def _recipe_publish_payload(recipe: Recipe) -> dict:
    return {
        "id": str(recipe.id),
        "site_id": str(recipe.site_id),
        "recipe_text": recipe.recipe_text or "",
        "pin_title": recipe.pin_title,
        "image_url": recipe.image_url or "",
        "generated_article": recipe.generated_article or "",
        "generated_json": recipe.generated_json or "",
        "focus_keyword": recipe.focus_keyword or "",
        "meta_description": recipe.meta_description or "",
        "category": recipe.category or "",
        "generated_images": recipe.generated_images or "",
        "wp_post_id": recipe.wp_post_id or "",
        "wp_permalink": recipe.wp_permalink or "",
        "seo_title": recipe.seo_title or "",
        "wp_tags": recipe.wp_tags or "",
        "pin_blog_link": recipe.pin_blog_link or "",
        "pin_design_image": recipe.pin_design_image or "",
    }


async def _db_set_job_status(
    job_id_str: str,
    status: JobStatus,
    total_rows: int | None = None,
    error: str | None = None,
) -> None:
    async with SessionLocal() as session:
        row = await session.execute(select(JobModel).where(JobModel.id == uuid.UUID(job_id_str)))
        job = row.scalar_one_or_none()
        if job:
            job.status = status
            if total_rows is not None:
                job.total_rows = total_rows
            if error is not None:
                job.error = error
                job.finished_at = datetime.now(timezone.utc)
            await session.commit()


async def _db_persist_progress(job_id_str: str, current: int, total: int) -> None:
    async with SessionLocal() as session:
        row = await session.execute(select(JobModel).where(JobModel.id == uuid.UUID(job_id_str)))
        job = row.scalar_one_or_none()
        if job:
            job.current_row = current
            job.total_rows = total
            await session.commit()


async def _db_persist_final(
    job_id_str: str,
    final_status: JobStatus,
    logs: list[str],
    error: str | None,
) -> None:
    async with SessionLocal() as session:
        row = await session.execute(select(JobModel).where(JobModel.id == uuid.UUID(job_id_str)))
        job = row.scalar_one_or_none()
        if job:
            if job.status == JobStatus.stopped:
                final_status = JobStatus.stopped
            job.status = final_status
            job.finished_at = datetime.now(timezone.utc)
            if error and final_status != JobStatus.stopped:
                job.error = error
            for msg in logs:
                session.add(JobLog(job_id=job.id, message=msg))
            await session.commit()


async def _db_revert_generating(recipe_ids: list[str]) -> None:
    async with SessionLocal() as session:
        await session.execute(
            update(Recipe)
            .where(
                Recipe.id.in_([uuid.UUID(rid) for rid in recipe_ids]),
                Recipe.status == RecipeStatus.generating,
            )
            .values(status=RecipeStatus.pending)
        )
        await session.commit()


async def _db_upsert_site_schedules(
    site_schedules: list[dict],
) -> None:
    """Upsert per-site publish schedules for auto_spy_generate jobs."""
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        for ss in site_schedules:
            row = await session.execute(
                select(SitePublishSchedule).where(
                    SitePublishSchedule.site_id == ss["site_id"]
                )
            )
            schedule = row.scalar_one_or_none()
            if schedule is None:
                schedule = SitePublishSchedule(
                    site_id=ss["site_id"],
                    enabled=True,
                    interval_minutes=ss["interval_minutes"],
                    next_run_at=ss["publish_start_at"],
                    updated_at=now,
                )
                session.add(schedule)
            else:
                schedule.enabled = True
                schedule.interval_minutes = ss["interval_minutes"]
                schedule.next_run_at = ss["publish_start_at"]
                schedule.updated_at = now
        await session.commit()


# ── Public entry point ─────────────────────────────────────────────────────────

async def start_auto_spy_generate_job(
    db_job: JobModel,
    shared_recipes: list[Any],
    site_schedules: list[dict],  # [{site_id, publish_start_at, interval_minutes}, ...]
    credentials: dict,
    prompts: dict[str, str],
    sites: list[Site],
    running_jobs: dict,          # job_manager._running
    main_loop: asyncio.AbstractEventLoop,
) -> None:
    """
    Create Recipe rows, launch a background thread that generates articles + pin
    images, then enable per-site publish schedules when done.

    `running_jobs` is the shared dict from JobManager so the job is trackable
    (stop/log streaming) without modifying any existing code paths.
    """
    from ..workers.job_manager import RunningJob
    from ..services.article_generator import generate_for_recipe, generate_images_only

    job_id_str = str(db_job.id)

    # ── Create Recipe records ──────────────────────────────────────────────────
    multi_site_groups: list[dict] = []
    created_recipe_ids: list[uuid.UUID] = []

    from ..database import SessionLocal as _SL
    async with _SL() as db:
        try:
            for idx, item in enumerate(shared_recipes):
                if isinstance(item, dict):
                    recipe_text = str(item.get("recipe_text", "")).strip()
                    image_url = str(item.get("image_url", "")).strip()
                else:
                    recipe_text = str(getattr(item, "recipe_text", "")).strip()
                    image_url = str(getattr(item, "image_url", "")).strip()

                if not recipe_text or not image_url:
                    continue

                group_items: list[dict] = []
                for s in sites:
                    new_recipe = Recipe(
                        site_id=s.id,
                        created_by=db_job.created_by,
                        created_by_job_id=db_job.id,
                        image_url=image_url,
                        recipe_text=recipe_text,
                        status=RecipeStatus.generating,
                    )
                    db.add(new_recipe)
                    await db.flush()
                    created_recipe_ids.append(new_recipe.id)
                    group_items.append({
                        "id": str(new_recipe.id),
                        "site_id": str(s.id),
                        "site_domain": s.domain,
                        "pinterest_url": s.pinterest_url or "",
                        "generate_recipe_json": bool(getattr(s, "generate_recipe_json", True)),
                        "pin_template_id": s.pin_template_id,
                        "recipe_text": recipe_text,
                        "image_url": image_url,
                        "group_idx": idx + 1,
                    })
                if group_items:
                    multi_site_groups.append({
                        "idx": idx + 1,
                        "items": group_items,
                        "recipe_text": recipe_text,
                        "image_url": image_url,
                    })

            if not multi_site_groups:
                await db.commit()
                await _db_set_job_status(job_id_str, JobStatus.failed, error="No valid shared recipes to process")
                return

            recipes_data = [{"id": str(rid)} for rid in created_recipe_ids]
            await db.commit()
            await _db_set_job_status(job_id_str, JobStatus.running, total_rows=len(recipes_data))
        except Exception as exc:
            await db.rollback()
            await _db_set_job_status(job_id_str, JobStatus.failed, error=f"Failed to create recipes: {exc}")
            return

    # ── Launch background thread ───────────────────────────────────────────────
    from ..workers.job_manager import RunningJob
    rj = RunningJob(db_job.id)
    running_jobs[job_id_str] = rj

    def _run() -> None:
        total = len(recipes_data)
        done = 0

        def _on_recipe_done(recipe_id: str, fields: dict) -> None:
            asyncio.run_coroutine_threadsafe(
                _db_update_recipe(recipe_id, fields), main_loop
            ).result()

        def _on_progress(current: int, total_: int) -> None:
            rj.set_progress(current, total_)
            asyncio.run_coroutine_threadsafe(
                _db_persist_progress(job_id_str, current, total_), main_loop
            ).result()

        def _finalize(final_status: JobStatus, error: str | None = None) -> None:
            asyncio.run_coroutine_threadsafe(
                _db_persist_final(job_id_str, final_status, rj._logs, error), main_loop
            ).result()
            running_jobs.pop(job_id_str, None)

        def _revert() -> None:
            asyncio.run_coroutine_threadsafe(
                _db_revert_generating([r["id"] for r in recipes_data]), main_loop
            ).result()

        rj.log(f"Auto Spy Generate — {total} recipe(s) across {len(sites)} site(s)")

        # Track generated data for the WP publish step
        per_recipe_generated: dict[str, dict] = {}

        try:
            for group in multi_site_groups:
                if rj.should_stop():
                    break
                items = group["items"]
                n_sites = len(items)
                rj.log(f"Input recipe {group['idx']}: {group['recipe_text'][:60]}")

                # ── Step 1: Generate Midjourney images ONCE for this recipe ──────
                per_item_images: dict[str, str] = {}
                discord_auth = credentials.get("discord_auth", "")
                if discord_auth and group.get("image_url"):
                    try:
                        rj.log(f"  Generating images once for {n_sites} site(s)…")
                        shared_images = generate_images_only(
                            recipe_title=group["recipe_text"].splitlines()[0].strip(),
                            image_url=group["image_url"],
                            credentials=credentials,
                            prompts=prompts,
                            log=rj.log,
                            should_stop=rj.should_stop,
                        )
                        if shared_images:
                            img_list: list[str] = json.loads(shared_images)
                            shuffled = list(img_list)
                            random.shuffle(shuffled)
                            # Distribute images across sites
                            chunk_size = max(1, len(shuffled) // n_sites)
                            for i, item in enumerate(items):
                                start = i * chunk_size
                                site_imgs = shuffled[start:start + chunk_size] or shuffled[:1]
                                per_item_images[item["id"]] = json.dumps(site_imgs)
                            rj.log(f"  Distributed {len(img_list)} image(s) across {n_sites} site(s)")
                    except Exception as e:
                        rj.log(f"  Midjourney failed for recipe {group['idx']}: {e} — continuing without images")
                else:
                    rj.log("  Midjourney skipped (no Discord credentials)")

                # Strip Discord from per-site calls — images already generated above
                run_creds = dict(credentials)
                run_creds["discord_auth"] = ""
                run_creds["discord_app_id"] = ""
                run_creds["discord_guild"] = ""
                run_creds["discord_channel"] = ""
                run_creds["mj_version"] = ""
                run_creds["mj_id"] = ""

                # ── Step 2: Generate article content per site (no Midjourney) ───
                for item in items:
                    if rj.should_stop():
                        break
                    rj.log("=" * 50)
                    rj.log(f"RECIPE {done + 1}/{total}: {item['recipe_text'][:60]}")
                    rj.log(f"  Site: {item['site_domain']}")
                    rj.log("=" * 50)

                    generated = generate_for_recipe(
                        recipe_id=item["id"],
                        recipe_text=item["recipe_text"],
                        image_url=item["image_url"],
                        site_domain=item["site_domain"],
                        credentials=run_creds,
                        prompts=prompts,
                        log=rj.log,
                        should_stop=rj.should_stop,
                        pinterest_url=item.get("pinterest_url", ""),
                        generate_recipe_json=bool(item.get("generate_recipe_json", True)),
                    )

                    if rj.should_stop():
                        break

                    # Inject the shared images generated in step 1
                    if item["id"] in per_item_images and not generated.get("error_message"):
                        generated["generated_images"] = per_item_images[item["id"]]

                    if not generated.get("error_message"):
                        # Use the per-site generated image for pin rendering so each site
                        # gets a unique food photo in its pin design. Fall back to the
                        # original input image_url if no generated images are available.
                        site_image_url = item["image_url"]
                        if generated.get("generated_images"):
                            try:
                                _imgs = json.loads(generated["generated_images"])
                                if _imgs and isinstance(_imgs, list) and _imgs[0]:
                                    site_image_url = _imgs[0]
                            except Exception:
                                pass

                        pin_title = generated.get("pin_title") or item["recipe_text"].splitlines()[0].strip()
                        random_pin_image_urls = _other_site_pin_images(items, per_item_images, item["id"])
                        pin_img = _render_pin_for_recipe(
                            image_url=site_image_url,
                            title=pin_title,
                            pin_template_id=item.get("pin_template_id"),
                            site_domain=item["site_domain"],
                            log=rj.log,
                            random_image_urls=random_pin_image_urls,
                            main_loop=main_loop,
                        )
                        if pin_img:
                            rj.log("Pin image rendered successfully")
                        per_recipe_generated[item["id"]] = {
                            "id": item["id"],
                            "recipe_text": item["recipe_text"],
                            "image_url": site_image_url,
                            "pin_design_image": pin_img,
                            **generated,
                        }

                    # Save recipe without pin_design_image (large blob — kept in memory for WP publish only)
                    db_fields = {k: v for k, v in generated.items() if k != "pin_design_image"}
                    if not generated.get("error_message") and item["id"] in per_recipe_generated:
                        db_fields["pin_design_image"] = per_recipe_generated[item["id"]].get("pin_design_image")
                    _on_recipe_done(item["id"], db_fields)
                    done += 1
                    _on_progress(done, total)

            if rj.should_stop():
                _revert()
                _finalize(JobStatus.stopped)
                return

            # Persist schedule metadata so resume can reconstruct the date sequence
            asyncio.run_coroutine_threadsafe(
                _db_upsert_site_schedules(site_schedules),
                main_loop,
            ).result()

            # ── Push to WordPress as scheduled posts (pin-designer pattern) ──────
            from ..site_credentials import get_random_wp_credentials

            site_obj_map = {str(s.id): s for s in sites}
            site_sched_map = {str(ss["site_id"]): ss for ss in site_schedules}

            # Group successfully generated recipes by site, preserving order
            site_recipes: dict[str, list[dict]] = {}
            for group in multi_site_groups:
                for item in group["items"]:
                    if item["id"] in per_recipe_generated:
                        site_recipes.setdefault(item["site_id"], []).append(item)

            rj.log("=" * 50)
            rj.log("Publishing to WordPress as scheduled posts...")

            pub_total = sum(len(v) for v in site_recipes.values())
            pub_succeeded = 0
            pub_failed: list[tuple[str, str]] = []

            for site_id_str, items in site_recipes.items():
                if rj.should_stop():
                    break
                ss = site_sched_map.get(site_id_str)
                site_obj = site_obj_map.get(site_id_str)
                if not ss or not site_obj:
                    continue
                publish_start = ss["publish_start_at"]
                step = timedelta(minutes=ss["interval_minutes"])
                for idx, item in enumerate(items):
                    recipe_data = per_recipe_generated.get(item["id"])
                    if not recipe_data:
                        continue
                    try:
                        wp_user, wp_pass = get_random_wp_credentials(site_obj)
                    except Exception as e:
                        rj.log(f"  [{site_obj.domain}] No WP credentials: {e}")
                        pub_failed.append((recipe_data.get("recipe_text", "")[:50], str(e)))
                        continue
                    site_config = {
                        "wp_url": site_obj.wp_url,
                        "wp_username": wp_user,
                        "wp_password": wp_pass,
                        "domain": site_obj.domain if site_obj.domain.startswith("http") else f"https://{site_obj.domain}",
                        "image_mode": getattr(site_obj, "image_mode", "featured_and_top") or "featured_and_top",
                    }
                    post_date = publish_start + step * idx
                    rj.log(f"  [{site_obj.domain}] #{idx + 1} (user: {wp_user}): {recipe_data['recipe_text'][:50]} → {post_date.strftime('%Y-%m-%d %H:%M UTC')}")
                    result = _publish_with_retry(recipe_data, site_config, post_date, rj.log, site_obj)
                    if result.get("error_message"):
                        reason = str(result["error_message"])
                        rj.log(f"    Permanently failed: {reason[:120]}")
                        pub_failed.append((recipe_data.get("recipe_text", "")[:50], reason))
                        asyncio.run_coroutine_threadsafe(
                            _db_mark_recipe_publish_failed(item["id"], reason),
                            main_loop,
                        ).result()
                    else:
                        pub_succeeded += 1
                        rj.log(f"    Scheduled: {result.get('wp_permalink', 'OK')}")
                        asyncio.run_coroutine_threadsafe(
                            _db_mark_recipe_published(item["id"], result.get("wp_post_id"), result.get("wp_permalink")),
                            main_loop,
                        ).result()
                    if idx < len(items) - 1 and not rj.should_stop():
                        _random_delay(rj.log, 25, 40)

            # ── Publishing summary ────────────────────────────────────────────────
            sep = "=" * 55
            rj.log(f"\n{sep}")
            rj.log(f"PUBLISHING SUMMARY: {pub_total} attempted — {pub_succeeded} published, {len(pub_failed)} failed")
            rj.log(sep)
            if pub_failed:
                rj.log("Failed recipes:")
                for t, reason in pub_failed:
                    rj.log(f"  • {t} — {reason[:100]}")

            rj.log("Auto Spy Generate completed successfully")
            _finalize(JobStatus.completed)

        except Exception as exc:
            rj.log(f"Auto Spy Generate failed: {exc}")
            _revert()
            _finalize(JobStatus.failed, error=str(exc))

    thread = threading.Thread(target=_run, daemon=True)
    rj._thread = thread
    thread.start()


# ── Resume entry point ─────────────────────────────────────────────────────────

async def resume_auto_spy_generate_job(
    db_job: JobModel,
    credentials: dict,
    prompts: dict[str, str],
    running_jobs: dict,
    main_loop: asyncio.AbstractEventLoop,
) -> bool:
    """Re-process pending recipes and retry publishable generated recipes."""
    from ..services.article_generator import generate_for_recipe, generate_images_only

    job_id_str = str(db_job.id)

    # Load pending recipes with their sites
    async with SessionLocal() as db:
        pending_rows = await db.execute(
            select(Recipe, Site)
            .join(Site, Recipe.site_id == Site.id)
            .where(
                Recipe.created_by_job_id == db_job.id,
                Recipe.status == RecipeStatus.pending,
            )
            .order_by(Recipe.recipe_text, Site.created_at)
        )
        pending = pending_rows.all()

        publishable_rows = await db.execute(
            select(Recipe, Site)
            .join(Site, Recipe.site_id == Site.id)
            .where(
                Recipe.created_by_job_id == db_job.id,
                Recipe.status.in_([RecipeStatus.generated, RecipeStatus.failed]),
                Recipe.generated_article.is_not(None),
                Recipe.generated_article != "",
                Recipe.wp_post_id.is_(None),
            )
            .order_by(Site.created_at, Recipe.created_at)
        )
        publishable = publishable_rows.all()

        if not pending and not publishable:
            await _db_set_job_status(job_id_str, JobStatus.completed)
            return False

        recipe_ids = [r.id for r, _ in pending]
        if recipe_ids:
            await db.execute(
                update(Recipe)
                .where(Recipe.id.in_(recipe_ids))
                .values(status=RecipeStatus.generating)
            )
            await db.commit()

        groups: dict[tuple, list[dict]] = {}
        for recipe, site in pending:
            key = (recipe.recipe_text, recipe.image_url)
            if key not in groups:
                groups[key] = []
            groups[key].append({
                "id": str(recipe.id),
                "site_id": str(site.id),
                "site_domain": site.domain,
                "pinterest_url": site.pinterest_url or "",
                "generate_recipe_json": bool(getattr(site, "generate_recipe_json", True)),
                "pin_template_id": site.pin_template_id,
                "recipe_text": recipe.recipe_text,
                "image_url": recipe.image_url,
            })

        multi_site_groups = [
            {"idx": i + 1, "items": items, "recipe_text": rt, "image_url": iu}
            for i, ((rt, iu), items) in enumerate(groups.items())
        ]
        recipes_data = [{"id": str(r.id)} for r, _ in pending]
        publish_retry_items = [
            {
                "id": str(recipe.id),
                "site_id": str(site.id),
                "site_domain": site.domain,
                "recipe_text": recipe.recipe_text,
                "image_url": recipe.image_url,
            }
            for recipe, site in publishable
        ]
        publish_retry_data = {
            str(recipe.id): _recipe_publish_payload(recipe)
            for recipe, _site in publishable
        }

        # Load site objects and their schedules for the WP publish step
        site_ids = list({str(site.id) for _, site in [*pending, *publishable]})
        site_rows = await db.execute(select(Site).where(Site.id.in_([uuid.UUID(s) for s in site_ids])))
        resume_sites = {str(s.id): s for s in site_rows.scalars().all()}

        sched_rows = await db.execute(
            select(SitePublishSchedule).where(SitePublishSchedule.site_id.in_([uuid.UUID(s) for s in site_ids]))
        )
        resume_schedules = {str(ss.site_id): ss for ss in sched_rows.scalars().all()}

        # Count already-published recipes per site for this job (to continue the date sequence)
        from sqlalchemy import func as _func
        pub_counts_rows = await db.execute(
            select(Recipe.site_id, _func.count(Recipe.id))
            .where(
                Recipe.created_by_job_id == db_job.id,
                Recipe.status == RecipeStatus.published,
            )
            .group_by(Recipe.site_id)
        )
        already_published = {str(sid): cnt for sid, cnt in pub_counts_rows.all()}

    await _db_set_job_status(job_id_str, JobStatus.running, total_rows=len(recipes_data) + len(publish_retry_items))

    rj = RunningJob(db_job.id)
    running_jobs[job_id_str] = rj

    def _run() -> None:
        total = len(recipes_data)
        done = 0

        def _on_recipe_done(recipe_id: str, fields: dict) -> None:
            asyncio.run_coroutine_threadsafe(_db_update_recipe(recipe_id, fields), main_loop).result()

        def _on_progress(current: int, total_: int) -> None:
            rj.set_progress(current, total_)
            asyncio.run_coroutine_threadsafe(_db_persist_progress(job_id_str, current, total_), main_loop).result()

        def _finalize(final_status: JobStatus, error: str | None = None) -> None:
            asyncio.run_coroutine_threadsafe(_db_persist_final(job_id_str, final_status, rj._logs, error), main_loop).result()
            running_jobs.pop(job_id_str, None)

        def _revert() -> None:
            asyncio.run_coroutine_threadsafe(_db_revert_generating([r["id"] for r in recipes_data]), main_loop).result()

        rj.log(f"Resuming Auto Spy Generate — {total} recipe(s) remaining")

        per_recipe_generated: dict[str, dict] = dict(publish_retry_data)

        try:
            for group in multi_site_groups:
                if rj.should_stop():
                    break
                items = group["items"]
                n_sites = len(items)
                rj.log(f"Input recipe {group['idx']}: {group['recipe_text'][:60]}")

                per_item_images: dict[str, str] = {}
                discord_auth = credentials.get("discord_auth", "")
                if discord_auth and group.get("image_url"):
                    try:
                        rj.log(f"  Generating images once for {n_sites} site(s)…")
                        shared_images = generate_images_only(
                            recipe_title=group["recipe_text"].splitlines()[0].strip(),
                            image_url=group["image_url"],
                            credentials=credentials,
                            prompts=prompts,
                            log=rj.log,
                            should_stop=rj.should_stop,
                        )
                        if shared_images:
                            img_list: list[str] = json.loads(shared_images)
                            shuffled = list(img_list)
                            random.shuffle(shuffled)
                            chunk_size = max(1, len(shuffled) // n_sites)
                            for i, item in enumerate(items):
                                start = i * chunk_size
                                site_imgs = shuffled[start:start + chunk_size] or shuffled[:1]
                                per_item_images[item["id"]] = json.dumps(site_imgs)
                            rj.log(f"  Distributed {len(img_list)} image(s) across {n_sites} site(s)")
                    except Exception as e:
                        rj.log(f"  Midjourney failed: {e} — continuing without images")
                else:
                    rj.log("  Midjourney skipped (no Discord credentials)")

                run_creds = dict(credentials)
                run_creds["discord_auth"] = ""
                run_creds["discord_app_id"] = ""
                run_creds["discord_guild"] = ""
                run_creds["discord_channel"] = ""
                run_creds["mj_version"] = ""
                run_creds["mj_id"] = ""

                for item in items:
                    if rj.should_stop():
                        break
                    rj.log("=" * 50)
                    rj.log(f"RECIPE {done + 1}/{total}: {item['recipe_text'][:60]}")
                    rj.log(f"  Site: {item['site_domain']}")
                    rj.log("=" * 50)

                    generated = generate_for_recipe(
                        recipe_id=item["id"],
                        recipe_text=item["recipe_text"],
                        image_url=item["image_url"],
                        site_domain=item["site_domain"],
                        credentials=run_creds,
                        prompts=prompts,
                        log=rj.log,
                        should_stop=rj.should_stop,
                        pinterest_url=item.get("pinterest_url", ""),
                        generate_recipe_json=bool(item.get("generate_recipe_json", True)),
                    )

                    if rj.should_stop():
                        break

                    if item["id"] in per_item_images and not generated.get("error_message"):
                        generated["generated_images"] = per_item_images[item["id"]]

                    if not generated.get("error_message"):
                        site_image_url = item["image_url"]
                        if generated.get("generated_images"):
                            try:
                                _imgs = json.loads(generated["generated_images"])
                                if _imgs and isinstance(_imgs, list) and _imgs[0]:
                                    site_image_url = _imgs[0]
                            except Exception:
                                pass

                        pin_title = generated.get("pin_title") or item["recipe_text"].splitlines()[0].strip()
                        random_pin_image_urls = _other_site_pin_images(items, per_item_images, item["id"])
                        pin_img = _render_pin_for_recipe(
                            image_url=site_image_url,
                            title=pin_title,
                            pin_template_id=item.get("pin_template_id"),
                            site_domain=item["site_domain"],
                            log=rj.log,
                            random_image_urls=random_pin_image_urls,
                            main_loop=main_loop,
                        )
                        if pin_img:
                            rj.log("Pin image rendered successfully")
                        per_recipe_generated[item["id"]] = {
                            "id": item["id"],
                            "recipe_text": item["recipe_text"],
                            "image_url": site_image_url,
                            "pin_design_image": pin_img,
                            **generated,
                        }

                    db_fields = {k: v for k, v in generated.items() if k != "pin_design_image"}
                    if not generated.get("error_message") and item["id"] in per_recipe_generated:
                        db_fields["pin_design_image"] = per_recipe_generated[item["id"]].get("pin_design_image")
                    _on_recipe_done(item["id"], db_fields)
                    done += 1
                    _on_progress(done, total)

            if rj.should_stop():
                _revert()
                _finalize(JobStatus.stopped)
                return

            # ── Push to WordPress as scheduled posts ─────────────────────────
            from ..site_credentials import get_random_wp_credentials

            site_resume_groups: dict[str, list[dict]] = {}
            for group in multi_site_groups:
                for item in group["items"]:
                    if item["id"] in per_recipe_generated:
                        site_resume_groups.setdefault(item["site_id"], []).append(item)
            for item in publish_retry_items:
                if item["id"] in per_recipe_generated:
                    site_resume_groups.setdefault(item["site_id"], []).append(item)

            rj.log("=" * 50)
            rj.log("Publishing to WordPress as scheduled posts...")

            pub_total = sum(len(v) for v in site_resume_groups.values())
            pub_succeeded = 0
            pub_failed: list[tuple[str, str]] = []

            now = datetime.now(timezone.utc)
            for site_id_str, items in site_resume_groups.items():
                if rj.should_stop():
                    break
                site_obj = resume_sites.get(site_id_str)
                ss = resume_schedules.get(site_id_str)
                if not site_obj:
                    continue
                interval_min = ss.interval_minutes if ss else 240
                step = timedelta(minutes=interval_min)
                offset = already_published.get(site_id_str, 0)
                publish_start = (ss.next_run_at if ss and ss.next_run_at else now)
                for idx, item in enumerate(items):
                    recipe_data = per_recipe_generated.get(item["id"])
                    if not recipe_data:
                        continue
                    try:
                        wp_user, wp_pass = get_random_wp_credentials(site_obj)
                    except Exception as e:
                        rj.log(f"  [{site_obj.domain}] No WP credentials: {e}")
                        pub_failed.append((recipe_data.get("recipe_text", "")[:50], str(e)))
                        continue
                    site_config = {
                        "wp_url": site_obj.wp_url,
                        "wp_username": wp_user,
                        "wp_password": wp_pass,
                        "domain": site_obj.domain if site_obj.domain.startswith("http") else f"https://{site_obj.domain}",
                        "image_mode": getattr(site_obj, "image_mode", "featured_and_top") or "featured_and_top",
                    }
                    post_date = publish_start + step * (offset + idx)
                    rj.log(f"  [{site_obj.domain}] #{offset + idx + 1} (user: {wp_user}): {recipe_data['recipe_text'][:50]} → {post_date.strftime('%Y-%m-%d %H:%M UTC')}")
                    result = _publish_with_retry(recipe_data, site_config, post_date, rj.log, site_obj)
                    if result.get("error_message"):
                        reason = str(result["error_message"])
                        rj.log(f"    Permanently failed: {reason[:120]}")
                        pub_failed.append((recipe_data.get("recipe_text", "")[:50], reason))
                        asyncio.run_coroutine_threadsafe(
                            _db_mark_recipe_publish_failed(item["id"], reason),
                            main_loop,
                        ).result()
                    else:
                        pub_succeeded += 1
                        rj.log(f"    Scheduled: {result.get('wp_permalink', 'OK')}")
                        asyncio.run_coroutine_threadsafe(
                            _db_mark_recipe_published(item["id"], result.get("wp_post_id"), result.get("wp_permalink")),
                            main_loop,
                        ).result()
                    if idx < len(items) - 1 and not rj.should_stop():
                        _random_delay(rj.log, 25, 40)

            # ── Publishing summary ────────────────────────────────────────────────
            sep = "=" * 55
            rj.log(f"\n{sep}")
            rj.log(f"PUBLISHING SUMMARY: {pub_total} attempted — {pub_succeeded} published, {len(pub_failed)} failed")
            rj.log(sep)
            if pub_failed:
                rj.log("Failed recipes:")
                for t, reason in pub_failed:
                    rj.log(f"  • {t} — {reason[:100]}")

            rj.log("Auto Spy Generate resumed and completed successfully")
            _finalize(JobStatus.completed)

        except Exception as exc:
            rj.log(f"Resume failed: {exc}")
            _revert()
            _finalize(JobStatus.failed, error=str(exc))

    thread = threading.Thread(target=_run, daemon=True)
    rj._thread = thread
    thread.start()
    return True
