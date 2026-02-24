from __future__ import annotations
import json
import time
from typing import Callable

from slugify import slugify

from .wordpress import (
    extract_and_remove_title, upload_image, add_recipe,
    validate_recipe_json, set_rank_math_meta,
)
from wordpress_xmlrpc import Client as WPClient, WordPressPost
from wordpress_xmlrpc.methods.posts import NewPost


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

        article_html = recipe.get("generated_article", "")
        recipe_json_str = recipe.get("generated_json", "")
        focus_kw = recipe.get("focus_keyword", "")
        meta_desc = recipe.get("meta_description", "")
        category = recipe.get("category", "")
        image_url = recipe.get("image_url", "")
        generated_images_str = recipe.get("generated_images", "")

        title, content = extract_and_remove_title(article_html)
        slug = slugify(focus_kw or title)

        img_source = image_url
        if generated_images_str:
            try:
                imgs = json.loads(generated_images_str)
                if imgs and isinstance(imgs, list):
                    img_source = imgs[0]
            except Exception:
                pass

        img_id, img_url = upload_image(img_source, wp, title, focus_kw, log=_log)

        wp_recipe_id = None
        recipe_data = validate_recipe_json(recipe_json_str)
        if recipe_data:
            wp_recipe_id = add_recipe(recipe_data, site_config, img_url, None, log=_log)

        if wp_recipe_id:
            content += f"\n[wprm-recipe id={wp_recipe_id}]"

        post = WordPressPost()
        post.title = title
        post.content = content
        post.slug = slug
        post.post_status = "draft"
        if img_id:
            post.thumbnail = img_id
        if category:
            post.terms_names = {"category": [category]}

        post_id = wp.call(NewPost(post))
        domain = site_config.get("domain", "")
        permalink = f'{domain}/{slug}/'

        if focus_kw or meta_desc:
            set_rank_math_meta(post_id, focus_kw, meta_desc, site_config, log=_log)

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
