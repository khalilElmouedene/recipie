from __future__ import annotations
import json
import re
import time
from datetime import datetime, timezone
from typing import Callable

from slugify import slugify

from .wordpress import (
    _parse_and_extract_title, inject_images_into_html, upload_pin_embed_images,
    upload_image, add_recipe, validate_recipe_json, set_rank_math_meta,
)
from wordpress_xmlrpc import Client as WPClient, WordPressPost
from wordpress_xmlrpc.methods.posts import NewPost, GetPost


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


def publish_recipe(
    recipe: dict,
    site_config: dict,
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
        wp = WPClient(site_config["wp_url"], site_config["wp_username"], site_config["wp_password"])
        domain = site_config.get("domain", "")

        article_html = recipe.get("generated_article", "")
        recipe_json_str = recipe.get("generated_json", "")
        focus_kw = recipe.get("focus_keyword", "")
        meta_desc = recipe.get("meta_description", "")
        category = recipe.get("category", "")
        image_url = recipe.get("image_url", "")
        generated_images_str = recipe.get("generated_images", "")

        # Parse HTML and strip title — keep soup object for proper image injection
        title_from_html, soup = _parse_and_extract_title(article_html)
        wp_title = _wordpress_display_title(recipe, title_from_html)
        slug = slugify(focus_kw or wp_title)

        # Resolve image sources (support 1 or 2 images from generated_images list)
        img1_source = image_url
        img2_source = None
        if generated_images_str:
            try:
                imgs = json.loads(generated_images_str)
                if imgs and isinstance(imgs, list):
                    img1_source = imgs[0]
                    if len(imgs) >= 2:
                        img2_source = imgs[1]
            except Exception:
                pass

        # Upload image 1 (featured + inline top)
        img1_id, img1_url = upload_image(img1_source, wp, wp_title, focus_kw, log=_log)
        # Fallback to original image_url if generated image URL expired/failed
        if img1_id is None and img1_source != image_url and image_url:
            _log("Generated image failed, retrying with original image_url...")
            img1_id, img1_url = upload_image(image_url, wp, wp_title, focus_kw, log=_log)

        # Upload image 2 (mid-article, optional)
        img2_id, img2_url = None, None
        if img2_source:
            img2_id, img2_url = upload_image(img2_source, wp, wp_title, focus_kw,
                                              image_slug=slugify(wp_title) + "-2", log=_log)

        # Normalize HTTP → HTTPS (XML-RPC sometimes returns http:// on https sites)
        def _to_https(url):
            if url and domain.startswith("https://") and url.startswith("http://"):
                return "https://" + url[7:]
            return url

        img1_url = _to_https(img1_url)
        img2_url = _to_https(img2_url)

        # Upload any pin embed base64 images to WordPress (replaces data: URL with real WP media URL)
        upload_pin_embed_images(soup, wp, wp_title, log=_log)

        # Inject images into the article using BeautifulSoup (img1 before first <p>, img2 before 4th <h2>)
        content = inject_images_into_html(soup, img1_url, img2_url)

        # Recipe card shortcode
        wp_recipe_id = None
        recipe_data = validate_recipe_json(recipe_json_str)
        if recipe_data:
            wp_recipe_id = add_recipe(recipe_data, site_config,
                                      image_url=img1_url, image_id=img1_id, log=_log)

        if wp_recipe_id:
            content += f"\n[wprm-recipe id={wp_recipe_id}]"

        post = WordPressPost()
        post.title = wp_title
        post.content = content
        post.slug = slug
        post.comment_status = "open"
        post.ping_status = "closed"

        now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
        if post_date_gmt is not None:
            pd = post_date_gmt
            if pd.tzinfo is not None:
                pd = pd.astimezone(timezone.utc)
            pd_naive = pd.replace(tzinfo=None)
            post.date = pd_naive
            post.post_status = "future" if pd_naive > now_naive else "publish"
        else:
            post.post_status = "publish"
        if img1_id:
            post.thumbnail = str(img1_id)
        if category:
            post.terms_names = {"category": [category]}

        post_id = wp.call(NewPost(post))

        # Fetch the real permalink from WordPress (not a manually constructed slug URL)
        try:
            published_post = wp.call(GetPost(post_id))
            permalink = getattr(published_post, "link", None) or f"{domain}/{slug}/"
        except Exception:
            permalink = f"{domain}/{slug}/"

        _log(f"Post created (ID: {post_id}) - {permalink}")
        result["wp_post_id"] = str(post_id)
        result["wp_permalink"] = permalink
        # Auto-populate pin_blog_link so Pinterest pins always link to the published post
        # (mirrors Articles_Publishing_Winsome.py which saves permalink back to the sheet)
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
):
    """Publish a list of generated recipes to WordPress.
    recipes: list of dicts with id + all generated fields.
    on_recipe_done: callback(recipe_id, result_dict) to persist wp_post_id/permalink.
    """
    _log = log or print
    _stop = should_stop or (lambda: False)
    total = len(recipes)

    domain = site_config.get("domain", "unknown")
    _log(f"=== PUBLISHING {total} RECIPES TO {domain} ===")

    for idx, recipe in enumerate(recipes):
        if _stop():
            _log("STOP REQUESTED — aborting")
            return

        recipe_id = recipe["id"]
        title = (recipe.get("recipe_text", "") or "").splitlines()[0][:60]
        _log(f"\nPublishing {idx + 1}/{total}: {title}")

        if on_progress:
            on_progress(idx + 1, total)

        result = publish_recipe(recipe, site_config, log=_log)

        if on_recipe_done:
            on_recipe_done(recipe_id, result)

        if idx < total - 1:
            time.sleep(2)

    _log("\n=== ALL RECIPES PUBLISHED ===")
