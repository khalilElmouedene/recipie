from __future__ import annotations
import base64
import io
import json
import re
import time
from datetime import datetime
from typing import Callable

import requests
from bs4 import BeautifulSoup
from PIL import Image
from slugify import slugify
from wordpress_xmlrpc import Client as WPClient, WordPressPost
from wordpress_xmlrpc.methods.posts import NewPost, EditPost
from wordpress_xmlrpc.methods.media import UploadFile


def extract_and_remove_title(html: str) -> tuple[str, str]:
    if not html or not isinstance(html, str):
        return "New Recipe Post", ""
    soup = BeautifulSoup(html, "html.parser")
    title = "New Recipe Post"
    h1 = soup.find("h1")
    if h1:
        title = h1.get_text(strip=True)
        h1.decompose()
    if title == "New Recipe Post":
        h2 = soup.find("h2")
        if h2:
            title = h2.get_text(strip=True)
            h2.decompose()
    return title, str(soup)


def get_first_valid_image_url(image_urls: str | list | None) -> str | None:
    if not image_urls:
        return None
    if isinstance(image_urls, str):
        urls = re.split(r'[\s,\n]+', image_urls.strip())
    elif isinstance(image_urls, list):
        urls = [u.strip() for u in image_urls if u and isinstance(u, str)]
    else:
        return None
    for url in urls:
        url = url.strip()
        if not url:
            continue
        if url.startswith("http"):
            return url
    return None


def convert_to_webp(image_data: bytes) -> bytes | None:
    try:
        img = Image.open(io.BytesIO(image_data))
        if img.mode == "RGBA":
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=85)
        return out.getvalue()
    except Exception:
        return None


def validate_recipe_json(raw: str | None) -> dict | None:
    if not raw or not isinstance(raw, str):
        return None
    try:
        raw = raw.strip()
        if raw.startswith('"') and raw.endswith('"'):
            raw = raw[1:-1]
        raw = raw.replace('\\"', '"')
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def upload_image(
    image_urls: str,
    wp: WPClient,
    title: str,
    alt_text: str,
    image_slug: str | None = None,
    site_config: dict | None = None,
    log: Callable[[str], None] | None = None,
) -> tuple[str | None, str | None]:
    _log = log or print
    url = get_first_valid_image_url(image_urls)
    if not url:
        _log("No valid image URL found")
        return None, None

    try:
        _log(f"Downloading image from {url[:80]}...")
        headers = {"User-Agent": "Mozilla/5.0"}
        r = requests.get(url, headers=headers, stream=True, timeout=30)
        r.raise_for_status()
        webp_data = convert_to_webp(r.content) or r.content

        title_slug = image_slug if image_slug else slugify(title)
        filename = f"{title_slug}.webp"
        data = {"name": filename, "type": "image/webp", "bits": webp_data, "overwrite": True}

        res = wp.call(UploadFile(data))
        attachment_id = res["id"]
        img_url = res["url"]

        wp.call(EditPost(attachment_id, {
            "post_title": title,
            "post_excerpt": alt_text or title,
            "post_content": title,
            "post_name": title_slug,
        }))

        if site_config and alt_text:
            _update_alt_text(attachment_id, alt_text, site_config, _log)

        _log(f"Image uploaded (ID: {attachment_id})")
        return attachment_id, img_url
    except Exception as e:
        _log(f"Error uploading image: {e}")
        return None, None


def upload_media(
    wp_url: str,
    username: str,
    password: str,
    filename: str,
    file_content: bytes,
    title: str = "Pin Design",
) -> dict:
    """Upload media directly to WordPress and return the media info."""
    wp = WPClient(wp_url, username, password)
    
    webp_data = convert_to_webp(file_content)
    if webp_data:
        file_content = webp_data
        if not filename.endswith(".webp"):
            filename = filename.rsplit(".", 1)[0] + ".webp"
        mime_type = "image/webp"
    else:
        if filename.lower().endswith(".png"):
            mime_type = "image/png"
        elif filename.lower().endswith((".jpg", ".jpeg")):
            mime_type = "image/jpeg"
        else:
            mime_type = "image/png"
    
    data = {
        "name": filename,
        "type": mime_type,
        "bits": file_content,
        "overwrite": True,
    }
    
    res = wp.call(UploadFile(data))
    attachment_id = res["id"]
    img_url = res["url"]
    
    wp.call(EditPost(attachment_id, {
        "post_title": title,
        "post_excerpt": title,
        "post_content": title,
    }))
    
    return {"id": attachment_id, "url": img_url}


def _update_alt_text(attachment_id: str, alt_text: str, site_config: dict, log: Callable):
    try:
        rest_url = site_config["wp_url"].replace("xmlrpc.php", "") + "wp-json/wp/v2"
        auth = (site_config["wp_username"], site_config["wp_password"])
        r = requests.post(f"{rest_url}/media/{attachment_id}", auth=auth, json={"alt_text": alt_text}, timeout=30)
        if r.status_code == 200:
            log("Alt text updated")
    except Exception as e:
        log(f"Error updating alt text: {e}")


def add_recipe(
    recipe_data: dict,
    site_config: dict,
    image_url: str | None = None,
    author: str | None = None,
    log: Callable[[str], None] | None = None,
) -> int | None:
    _log = log or print
    try:
        api_url = site_config["wp_url"].replace("xmlrpc.php", "wp-json/wp/v2/wprm_recipe")
        token = base64.b64encode(f"{site_config['wp_username']}:{site_config['wp_password']}".encode()).decode()
        headers = {"Authorization": f"Basic {token}", "Content-Type": "application/json"}

        if image_url:
            recipe_data["image_url"] = image_url
            recipe_data["pin_image_url"] = image_url
        if author:
            recipe_data["author_name"] = author

        r = requests.post(api_url, headers=headers, json={"recipe": recipe_data}, timeout=30)
        r.raise_for_status()
        recipe_id = r.json().get("id")
        _log(f"Recipe created (ID: {recipe_id})")
        return recipe_id
    except Exception as e:
        _log(f"Error adding recipe: {e}")
        return None


def set_rank_math_meta(
    post_id: str,
    focus_keyword: str,
    seo_description: str,
    site_config: dict,
    log: Callable[[str], None] | None = None,
):
    _log = log or print
    try:
        api_url = site_config["wp_url"].replace("xmlrpc.php", f"wp-json/wp/v2/posts/{post_id}")
        token = base64.b64encode(f"{site_config['wp_username']}:{site_config['wp_password']}".encode()).decode()
        headers = {"Authorization": f"Basic {token}", "Content-Type": "application/json"}
        meta = {}
        if focus_keyword:
            meta["rank_math_focus_keyword"] = focus_keyword
        if seo_description:
            meta["rank_math_description"] = seo_description
        if meta:
            r = requests.post(api_url, headers=headers, json={"meta": meta}, timeout=30)
            r.raise_for_status()
            _log(f"Rank Math SEO meta updated for post {post_id}")
    except Exception as e:
        _log(f"Error setting Rank Math meta: {e}")


def insert_image_after_paragraph(html: str, image_url: str, alt_text: str, paragraph_number: int = 4) -> str:
    if not image_url:
        return html
    soup = BeautifulSoup(html, "html.parser")
    paragraphs = soup.find_all("p")
    if len(paragraphs) >= paragraph_number:
        target = paragraphs[paragraph_number - 1]
        img_html = f'''<figure class="wp-block-image size-large pinimg">
            <img decoding="async" src="{image_url}" alt="{alt_text}" class="wp-image-0"/>
        </figure>'''
        img_tag = BeautifulSoup(img_html, "html.parser").find("figure")
        target.insert_after(img_tag)
    return str(soup)


def create_post(
    row: list[str],
    site_config: dict,
    project: str,
    row_index: int,
    worksheet=None,
    log: Callable[[str], None] | None = None,
) -> str | None:
    _log = log or print
    wp = WPClient(site_config["wp_url"], site_config["wp_username"], site_config["wp_password"])

    if project == "V2":
        return _create_post_v2(row, site_config, wp, row_index, worksheet, _log)
    else:
        return _create_post_v1(row, site_config, wp, row_index, worksheet, _log)


def _create_post_v1(row, site_config, wp, row_index, worksheet, log):
    image_urls = row[0] if len(row) > 0 else ""
    html = row[1] if len(row) > 1 else ""
    recipe_json_str = row[2] if len(row) > 2 else ""
    category = row[3] if len(row) > 3 else ""
    publish_date = row[4] if len(row) > 4 else ""
    focus_kw = row[5] if len(row) > 5 else ""
    seo_desc = row[6] if len(row) > 6 else ""
    author = row[8] if len(row) > 8 else None

    title, content = extract_and_remove_title(html)
    slug = slugify(focus_kw or title)

    img_id, img_url = upload_image(image_urls, wp, title, focus_kw, log=log)

    recipe_id = None
    recipe_data = validate_recipe_json(recipe_json_str)
    if recipe_data:
        recipe_id = add_recipe(recipe_data, site_config, img_url, author, log=log)

    if recipe_id:
        content += f"\n[wprm-recipe id={recipe_id}]"

    post = WordPressPost()
    post.title = title
    post.content = content
    post.slug = slug
    post.post_status = "publish" if publish_date else "draft"
    if img_id:
        post.thumbnail = img_id
    if category:
        post.terms_names = {"category": [category]}
    if publish_date:
        try:
            post.date = datetime.strptime(publish_date, "%Y-%m-%d")
        except ValueError:
            try:
                post.date = datetime.strptime(publish_date, "%Y/%m/%d %H:%M")
            except ValueError:
                pass

    post_id = wp.call(NewPost(post))
    domain = site_config.get("domain", "")
    permalink = f'{domain}/{slug}/'

    if worksheet:
        worksheet.update_cell(row_index, 10, permalink)

    log(f"Post created (ID: {post_id}) - {permalink}")
    return post_id


def _create_post_v2(row, site_config, wp, row_index, worksheet, log):
    image_urls = row[0] if len(row) > 0 else ""
    html = row[1] if len(row) > 1 else ""
    recipe_json_str = row[2] if len(row) > 2 else ""
    category = row[3] if len(row) > 3 else ""
    publish_date = row[4] if len(row) > 4 else ""
    image_slug = row[5] if len(row) > 5 else None
    focus_kw = row[6] if len(row) > 6 else ""
    seo_desc = row[7] if len(row) > 7 else ""
    pin_image_url = row[8] if len(row) > 8 else None
    author = row[9] if len(row) > 9 else None

    title, content = extract_and_remove_title(html)
    slug = slugify(focus_kw or title)

    img_id, img_url = upload_image(
        image_urls, wp, title, focus_kw, image_slug=image_slug, site_config=site_config, log=log
    )

    recipe_id = None
    recipe_data = validate_recipe_json(recipe_json_str)
    if recipe_data:
        recipe_id = add_recipe(recipe_data, site_config, img_url, author, log=log)

    if pin_image_url:
        content = insert_image_after_paragraph(content, pin_image_url, focus_kw)

    if recipe_id:
        content += f"\n[wprm-recipe id={recipe_id}]"

    post = WordPressPost()
    post.title = title
    post.content = content
    post.slug = slug
    post.post_status = "publish" if publish_date else "draft"
    if img_id:
        post.thumbnail = img_id
    if category:
        post.terms_names = {"category": [category]}
    if publish_date:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M"):
            try:
                post.date = datetime.strptime(publish_date, fmt)
                break
            except ValueError:
                continue

    post_id = wp.call(NewPost(post))
    domain = site_config.get("domain", "")
    permalink = f'{domain}/{slug}/'

    if worksheet:
        worksheet.update_cell(row_index, 11, permalink)

    if focus_kw or seo_desc:
        set_rank_math_meta(post_id, focus_kw, seo_desc, site_config, log=log)

    log(f"Post created (ID: {post_id}) - {permalink}")
    return post_id
