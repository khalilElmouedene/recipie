from __future__ import annotations
import json
import time
from typing import Callable

from slugify import slugify

from .wordpress import (
    _parse_and_extract_title, inject_images_into_html,
    upload_image, add_recipe, validate_recipe_json, set_rank_math_meta,
)
from wordpress_xmlrpc import Client as WPClient, WordPressPost
from wordpress_xmlrpc.methods.posts import NewPost, GetPost


def publish_recipe(
    recipe: dict,
    site_config: dict,
    log: Callable[[str], None] | None = None,
) -> dict:
    """Publish a single generated recipe to WordPress.
    recipe: dict with generated_article, generated_json, image_url, focus_keyword, meta_description, category, generated_images.
    site_config: dict with wp_url, wp_username, wp_password, domain.
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
        title, soup = _parse_and_extract_title(article_html)
        slug = slugify(focus_kw or title)

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
        img1_id, img1_url = upload_image(img1_source, wp, title, focus_kw, log=_log)
        # Fallback to original image_url if generated image URL expired/failed
        if img1_id is None and img1_source != image_url and image_url:
            _log("Generated image failed, retrying with original image_url...")
            img1_id, img1_url = upload_image(image_url, wp, title, focus_kw, log=_log)

        # Upload image 2 (mid-article, optional)
        img2_id, img2_url = None, None
        if img2_source:
            img2_id, img2_url = upload_image(img2_source, wp, title, focus_kw,
                                              image_slug=slugify(title) + "-2", log=_log)

        # Normalize HTTP → HTTPS (XML-RPC sometimes returns http:// on https sites)
        def _to_https(url):
            if url and domain.startswith("https://") and url.startswith("http://"):
                return "https://" + url[7:]
            return url

        img1_url = _to_https(img1_url)
        img2_url = _to_https(img2_url)

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
        post.title = title
        post.content = content
        post.slug = slug
        post.post_status = "publish"
        post.comment_status = "open"
        post.ping_status = "closed"
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

        if focus_kw or meta_desc or title:
            set_rank_math_meta(post_id, focus_kw, meta_desc, site_config, seo_title=title, log=_log)

        _log(f"Post created (ID: {post_id}) - {permalink}")
        result["wp_post_id"] = str(post_id)
        result["wp_permalink"] = permalink

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
