from __future__ import annotations
import json
import random
import re
import requests
import time
from datetime import datetime, timezone
from typing import Callable

from slugify import slugify

from .wordpress import (
    _parse_and_extract_title, inject_images_into_html, upload_pin_embed_images,
    upload_image, upload_base64_image, add_recipe, validate_recipe_json, set_rank_math_meta,
    _wp_rest_base, _get_or_create_term, _wp_session,
)


def _random_delay(log: Callable, min_sec: float = 4, max_sec: float = 9) -> None:
    delay = random.uniform(min_sec, max_sec)
    log(f"Waiting {delay:.2f}s before next request...")
    time.sleep(delay)


def _strip_title_decorations(title: str) -> str:
    """Remove parenthetical / bracketed asides (ingredient notes, etc.) for WP + Rank Math titles."""
    if not title:
        return title
    t = title.strip()
    while True:
        nt = re.sub(r"\s*\[[^\]]*\]", "", t)
        nt = re.sub(r"\s*\([^)]*\)", "", nt)
        nt = re.sub(r"\s+", " ", nt).strip()
        if nt == t:
            break
        t = nt
    return t


def _safe_strip_title_decorations(title: str) -> str:
    """Strip (…) / […] only when the result still looks like a full title, not a leftover fragment."""
    if not title:
        return title
    cleaned = _strip_title_decorations(title)
    if not cleaned.strip():
        return title
    # If the original was long but stripping left a tiny tail (e.g. "(Full Title Here) 4 onions" → "4 onions"), keep original.
    if len(title) > 40 and len(cleaned) < min(28, max(15, len(title) // 3)):
        return title
    return cleaned


def _wordpress_display_title(recipe: dict, title_from_html: str) -> str:
    """Blog post title from the article H1 (same as older publishes), with light (…) / […] cleanup.

    Does not use pin_title — Pinterest titles are intentionally short and break SEO post titles.
    """
    recipe_line = (recipe.get("recipe_text") or "").splitlines()[0].strip()
    html_t = (title_from_html or "").strip()
    placeholder = "New Recipe Post"

    h = _safe_strip_title_decorations(html_t) if html_t and html_t != placeholder else ""
    r = _safe_strip_title_decorations(recipe_line) if recipe_line else ""

    if h and r:
        # Prefer the longer string so we keep full H1-style titles over a short recipe prompt line.
        return h if len(h) >= len(r) else r
    if h:
        return h
    if r:
        return r
    return html_t or recipe_line or placeholder


def _has_recipe_generator_pin_embed(soup) -> bool:
    return soup.find("figure", attrs={"data-recipe-generator-pin-embed": "1"}) is not None


def _remove_recipe_generator_pin_embeds(soup) -> int:
    removed = 0
    for figure in soup.find_all("figure", attrs={"data-recipe-generator-pin-embed": "1"}):
        figure.decompose()
        removed += 1
    return removed


def _site_allows_pin_embed(site_config: dict | None) -> bool:
    if not site_config:
        return False
    value = site_config.get("embed_pin_in_article", False)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def publish_recipe(
    recipe: dict,
    site_config: dict | None,
    log: Callable[[str], None] | None = None,
    *,
    post_date_gmt: datetime | None = None,
) -> dict:
    """Publish a single generated recipe to WordPress.
    recipe: dict with recipe_text, generated_article, generated_json, image_url, focus_keyword,
    meta_description, category, generated_images (pin_title is ignored for the blog title — it is for
    Pinterest only). Post / Rank Math title comes from the article H1 when present, else recipe_text
    first line; parentheticals are stripped only when the result still looks like a full title.
    site_config: dict with wp_url, wp_username, wp_password, domain.
    post_date_gmt: optional UTC datetime. If in the future, post is created as WordPress "Scheduled" (status future).
      If in the past, post is published immediately with that backdated post_date_gmt.
    Returns dict with wp_post_id, wp_permalink or error_message.
    """
    _log = log or print
    result: dict = {}

    try:
        domain = site_config.get("domain", "")

        article_html = recipe.get("generated_article", "")
        recipe_json_str = recipe.get("generated_json", "")
        focus_kw = recipe.get("focus_keyword", "")
        meta_desc = recipe.get("meta_description", "")
        category = recipe.get("category", "")
        image_url = recipe.get("image_url", "")
        generated_images_str = recipe.get("generated_images", "")
        pin_design_image = recipe.get("pin_design_image", "") or ""
        seo_title = (recipe.get("seo_title") or "").strip()
        wp_tags_raw = (recipe.get("wp_tags") or "").strip()

        # Pin design image can be a base64 data URI (freshly rendered) or a hosted URL
        # (already uploaded to the server via api.uploadPinImageToServer).
        # Both are valid — accept either form.
        _pin_is_base64 = isinstance(pin_design_image, str) and pin_design_image.startswith("data:image/")
        _pin_is_url = isinstance(pin_design_image, str) and pin_design_image.startswith("http")
        has_pin_image = bool(pin_design_image and (_pin_is_base64 or _pin_is_url))
        _log(f"Pin design image: {'base64' if _pin_is_base64 else 'url' if _pin_is_url else 'none'} — has_pin_image={has_pin_image}")

        # Parse HTML and strip title — keep soup object for proper image injection
        title_from_html, soup = _parse_and_extract_title(article_html)
        embed_pin_in_article = _site_allows_pin_embed(site_config)
        if not embed_pin_in_article:
            removed_embeds = _remove_recipe_generator_pin_embeds(soup)
            if removed_embeds:
                _log(f"Pin image embed disabled for this site; removed {removed_embeds} existing article embed(s).")
        has_article_pin_embed = embed_pin_in_article and _has_recipe_generator_pin_embed(soup)
        # Use AI-generated SEO title when available, fall back to H1-derived title
        wp_title = seo_title if seo_title else _wordpress_display_title(recipe, title_from_html)
        slug = slugify(focus_kw or wp_title)

        # Prefer our generated (Midjourney) images over the raw source image_url.
        # generated_images are cached on our server under /uploads/ — stable and always available.
        img1_source = image_url
        if generated_images_str:
            try:
                imgs = json.loads(generated_images_str)
                if imgs and isinstance(imgs, list) and imgs[0]:
                    img1_source = imgs[0]
            except Exception:
                pass

        # Upload image (featured + inline top)
        img1_id, img1_url = upload_image(img1_source, site_config, wp_title, focus_kw, log=_log)
        # Fallback to original image_url if generated image failed
        if img1_id is None and img1_source != image_url and image_url:
            _log("Generated image failed, retrying with original image_url...")
            img1_id, img1_url = upload_image(image_url, site_config, wp_title, focus_kw, log=_log)
        _log("Image uploaded.")
        _random_delay(_log)

        # Normalize HTTP → HTTPS (some WP installs return http:// even on https sites)
        def _to_https(url):
            if url and domain.startswith("https://") and url.startswith("http://"):
                return "https://" + url[7:]
            return url

        img1_url = _to_https(img1_url)

        # Upload any allowed pin embed base64 images to WordPress (replaces data: URL with real WP media URL)
        if embed_pin_in_article:
            upload_pin_embed_images(soup, site_config, wp_title, log=_log)

        # The site's image mode controls the normal food photo. A Pin Designer
        # image is handled separately below and should not suppress this setting.
        image_mode = site_config.get("image_mode", "featured_and_top")
        if image_mode == "featured_and_top":
            content = inject_images_into_html(soup, img1_url)
        else:
            content = str(soup.find("body").decode_contents() if soup.find("body") else soup)

        # Recipe card shortcode
        wp_recipe_id = None
        recipe_data = validate_recipe_json(recipe_json_str)
        if recipe_data:
            wp_recipe_id = add_recipe(recipe_data, site_config,
                                      image_url=img1_url, image_id=img1_id, log=_log)

        if wp_recipe_id:
            content += f"\n[wprm-recipe id={wp_recipe_id}]"
            _log("Recipe card created.")
            _random_delay(_log)

        # Upload pin design image and insert it after the recipe card, unless the
        # article already contains the app-managed pin embed block.
        # Handles both base64 data URIs and hosted https:// URLs.
        if embed_pin_in_article and has_pin_image and not has_article_pin_embed:
            if _pin_is_base64:
                pin_wp_url = upload_base64_image(pin_design_image, site_config, wp_title, log=_log)
            else:
                _, pin_wp_url = upload_image(pin_design_image, site_config, wp_title, focus_kw, log=_log)
            _log(f"Pin image uploaded to WP: {pin_wp_url or 'FAILED'}")
            if pin_wp_url:
                content += f'\n<img src="{pin_wp_url}" alt="{wp_title}" loading="lazy" decoding="async" />'
            _random_delay(_log)
        elif embed_pin_in_article and has_pin_image:
            _log("Pin image already embedded in article; skipping duplicate append.")
        elif has_pin_image:
            _log("Pin image embed disabled for this site; skipping article pin image append.")

        base_url = _wp_rest_base(site_config)
        auth = (site_config["wp_username"], site_config["wp_password"])
        wp_session = _wp_session(auth)
        post_payload: dict = {
            "title": wp_title, "content": content, "slug": slug,
            "comment_status": "open", "ping_status": "closed", "status": "publish",
        }
        now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
        if post_date_gmt is not None:
            pd = post_date_gmt
            if pd.tzinfo is not None:
                pd = pd.astimezone(timezone.utc)
            pd_naive = pd.replace(tzinfo=None)
            post_payload["date_gmt"] = pd_naive.strftime("%Y-%m-%dT%H:%M:%S")
            post_payload["status"] = "future" if pd_naive > now_naive else "publish"
        if img1_id:
            post_payload["featured_media"] = int(img1_id)
        if category:
            cat_id = _get_or_create_term(category, "categories", base_url, auth, _log)
            if cat_id:
                post_payload["categories"] = [cat_id]
        if wp_tags_raw:
            tags_list = [t.strip() for t in wp_tags_raw.split(",") if t.strip()]
            tag_ids = [tid for t in tags_list if (tid := _get_or_create_term(t, "tags", base_url, auth, _log))]
            if tag_ids:
                post_payload["tags"] = tag_ids
        # Yoast SEO meta merged into create call (requires Yoast v14+; silently ignored on older versions)
        if focus_kw or meta_desc or wp_title:
            post_payload["meta"] = {
                "_yoast_wpseo_title": wp_title,
                "_yoast_wpseo_metadesc": meta_desc,
                "_yoast_wpseo_focuskw": focus_kw,
            }

        rp = wp_session.post(f"{base_url}/posts", json=post_payload, timeout=30)
        rp.raise_for_status()
        rp_body = rp.json()
        post_id = rp_body["id"]
        permalink = rp_body.get("link") or f"{domain}/{slug}/"

        _log(f"Post created (ID: {post_id}) - {permalink}")
        result["wp_post_id"] = str(post_id)
        result["wp_permalink"] = permalink
        result["pin_blog_link"] = permalink

        try:
            if focus_kw or meta_desc or wp_title:
                set_rank_math_meta(post_id, focus_kw, meta_desc, site_config, seo_title=wp_title, log=_log)
        except Exception as seo_err:
            _log(f"Rank Math SEO meta failed (post published OK): {seo_err}")

    except Exception as e:
        _log(f"Publishing failed: {e}")
        result["error_message"] = str(e)

    return result


def publish_recipes_from_db(
    recipes: list[dict],
    site_config: dict,
    log: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    on_progress: Callable[[int, int], None] | None = None,
    on_recipe_done: Callable[[str, dict], None] | None = None,
    *,
    progress_offset: int = 0,
    progress_total: int | None = None,
    emit_summary_logs: bool = True,
    max_attempts: int = 3,
    retry_delay: float = 8.0,
) -> tuple[int, int, int]:
    """Publish a list of generated recipes to WordPress.

    Each recipe is attempted up to *max_attempts* times before being marked
    permanently failed. The job always continues with the next recipe regardless
    of individual failures, and a summary is logged at the end.
    Returns (attempted, succeeded, failed) counts.
    """
    _log = log or print
    _stop = should_stop or (lambda: False)
    total = len(recipes)
    effective_total = progress_total if progress_total is not None else total
    processed = 0
    succeeded = 0
    failed_items: list[tuple[str, str]] = []  # (short title, error reason)

    if emit_summary_logs:
        domains = {
            str((recipe.get("__site_config") or site_config or {}).get("domain", "unknown"))
            for recipe in recipes
        }
        if len(domains) == 1:
            _log(f"=== PUBLISHING {total} RECIPES TO {next(iter(domains))} ===")
        else:
            _log(f"=== PUBLISHING {total} RECIPES ACROSS {len(domains)} SITE(S) ===")

    for idx, recipe in enumerate(recipes):
        if _stop():
            _log("STOP REQUESTED — aborting")
            break

        recipe_id = recipe["id"]
        title = (recipe.get("recipe_text", "") or "").splitlines()[0][:60]
        display_current = progress_offset + idx + 1
        _log(f"\nPublishing {display_current}/{effective_total}: {title}")
        processed = idx + 1

        if on_progress:
            on_progress(progress_offset + processed, effective_total)

        effective_site_config = recipe.get("__site_config") or site_config
        if not effective_site_config:
            raise ValueError("Missing WordPress site configuration for publish batch")

        # ── Retry loop ──────────────────────────────────────────────────────────
        result: dict = {"error_message": "No attempts made"}
        for attempt in range(1, max_attempts + 1):
            result = publish_recipe(
                recipe,
                effective_site_config,
                log=_log,
                post_date_gmt=recipe.get("__post_date_gmt"),
            )
            if not result.get("error_message"):
                break
            if attempt < max_attempts:
                err_preview = str(result["error_message"])[:120]
                # 403 = security plugin rate-limit / IP block — wait much longer than a normal retry
                is_rate_limited = "403" in err_preview or "forbidden" in err_preview.lower()
                wait = 90.0 if is_rate_limited else retry_delay
                _log(f"  Attempt {attempt}/{max_attempts} failed: {err_preview} — retrying in {wait:.0f}s…")
                time.sleep(wait)

        if result.get("error_message"):
            reason = str(result["error_message"])
            failed_items.append((title[:50], reason))
            _log(f"  Permanently failed after {max_attempts} attempt(s): {reason[:120]}")
        else:
            succeeded += 1

        if on_recipe_done:
            on_recipe_done(recipe_id, result)

        if idx < total - 1 and not _stop():
            # 30s between recipes to avoid triggering WordPress security plugin rate limits
            time.sleep(30)

    # ── Summary ─────────────────────────────────────────────────────────────────
    n_failed = len(failed_items)
    if emit_summary_logs:
        sep = "=" * 55
        _log(f"\n{sep}")
        _log(f"PUBLISHING SUMMARY: {processed} attempted — {succeeded} published, {n_failed} failed")
        _log(sep)
        if failed_items:
            _log("Failed recipes:")
            for t, reason in failed_items:
                _log(f"  • {t} — {reason[:100]}")
        _log("\n=== ALL RECIPES PUBLISHED ===")
    return processed, succeeded, n_failed
