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


def _wp_session(auth: tuple) -> requests.Session:
    """Return a requests Session that keeps Basic Auth through redirects.
    By default requests drops the Authorization header when a redirect changes
    the host (e.g. www → non-www). This subclass always re-attaches auth."""
    class _StickeyAuthSession(requests.Session):
        def rebuild_auth(self, prepared_request, response):
            prepared_request.prepare_auth(self.auth)

    session = _StickeyAuthSession()
    session.auth = auth
    return session


def _wp_rest_base(wp_url_or_site_config) -> str:
    """Return the /wp-json/wp/v2 base URL from a raw URL string or site_config dict."""
    raw = (
        wp_url_or_site_config.get("wp_url", "")
        if isinstance(wp_url_or_site_config, dict)
        else (wp_url_or_site_config or "")
    )
    return raw.replace("xmlrpc.php", "").rstrip("/") + "/wp-json/wp/v2"


def _get_or_create_term(name: str, taxonomy: str, base_url: str, auth: tuple, log: Callable) -> int | None:
    """Look up a category or tag by exact name; create it if absent. Returns ID or None."""
    if not name or not name.strip():
        return None
    try:
        session = _wp_session(auth)
        r = session.get(
            f"{base_url}/{taxonomy}",
            params={"search": name, "per_page": 5}, timeout=15,
        )
        if r.status_code == 200:
            for item in r.json():
                if item.get("name", "").lower() == name.strip().lower():
                    return item["id"]
        r2 = session.post(f"{base_url}/{taxonomy}", json={"name": name.strip()}, timeout=15)
        if r2.status_code in (200, 201):
            return r2.json().get("id")
        log(f"Term create failed for '{name}' ({taxonomy}): {r2.status_code}")
    except Exception as e:
        log(f"Term lookup error for '{name}': {e}")
    return None


def _convert_markdown_links(html: str) -> str:
    """Convert any markdown-style links [text](url) left in the HTML to proper <a> tags.
    The AI sometimes generates these inside otherwise-HTML content."""
    return re.sub(
        r'\[([^\]]+)\]\((https?://[^)]+)\)',
        r'<a href="\2">\1</a>',
        html,
    )


def _parse_and_extract_title(html: str):
    """Parse HTML, strip the H1/H2 title, return (title, soup).
    The soup object can be further manipulated before converting to string."""
    if not html or not isinstance(html, str):
        return "New Recipe Post", BeautifulSoup("", "html.parser")
    html = _convert_markdown_links(html)
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
    return title, soup


def upload_base64_image(data_uri: str, site_config: dict, title: str, log: Callable[[str], None] | None = None) -> str | None:
    """Upload a base64 data-URI image to the WordPress media library and return its URL."""
    _log = log or print
    try:
        if "," not in data_uri:
            return None
        _header, b64data = data_uri.split(",", 1)
        img_bytes = base64.b64decode(b64data)
        webp_data = convert_to_webp(img_bytes) or img_bytes
        filename = f"{slugify(title or 'pin')}-pin.webp"
        base_url = _wp_rest_base(site_config)
        auth = (site_config["wp_username"], site_config["wp_password"])
        r = _wp_session(auth).post(
            f"{base_url}/media", data=webp_data, timeout=60,
            headers={"Content-Type": "image/webp", "Content-Disposition": f'attachment; filename="{filename}"'},
        )
        r.raise_for_status()
        wp_url = r.json().get("source_url", "")
        if wp_url:
            _log(f"Pin image uploaded to WordPress: {wp_url[:80]}")
            return wp_url
    except Exception as e:
        _log(f"Pin image upload failed: {e}")
    return None


def upload_pin_embed_images(soup, site_config: dict, title: str, log: Callable[[str], None] | None = None) -> None:
    """Find any pin-embed <figure> in the soup, upload their base64 images to WordPress,
    and replace data: src with the real WordPress media URL in-place."""
    _log = log or print
    base_url = _wp_rest_base(site_config)
    auth = (site_config["wp_username"], site_config["wp_password"])
    session = _wp_session(auth)
    for figure in soup.find_all("figure", attrs={"data-recipe-generator-pin-embed": "1"}):
        img = figure.find("img")
        if not img:
            continue
        src = img.get("src", "")
        if not src.startswith("data:image/"):
            continue  # Already a real URL — nothing to do
        try:
            header, b64data = src.split(",", 1)
            img_bytes = base64.b64decode(b64data)
            webp_data = convert_to_webp(img_bytes) or img_bytes
            filename = f"{slugify(title)}-pin.webp"
            r = session.post(
                f"{base_url}/media", data=webp_data, timeout=60,
                headers={"Content-Type": "image/webp", "Content-Disposition": f'attachment; filename="{filename}"'},
            )
            r.raise_for_status()
            wp_url = r.json().get("source_url", "")
            if wp_url:
                img["src"] = wp_url
                _log(f"Pin embed image uploaded to WordPress: {wp_url[:80]}")
        except Exception as e:
            _log(f"Pin embed image upload failed: {e}")


def inject_images_into_html(soup, img1_url: str | None, img2_url: str | None = None) -> str:
    """Insert images into article HTML using BeautifulSoup — mirrors the Winsome publisher script.
    img1 is inserted before the first <p> (top of article).
    img2 is inserted before the 4th <h2> (mid-article).
    Returns the final HTML string."""
    # Strip pre-existing <img> tags from AI-generated HTML, but preserve pin embed images
    pin_embed_imgs: set = set()
    for figure in soup.find_all("figure", attrs={"data-recipe-generator-pin-embed": "1"}):
        for img in figure.find_all("img"):
            pin_embed_imgs.add(id(img))
    for img_tag in soup.find_all("img"):
        if id(img_tag) not in pin_embed_imgs:
            img_tag.decompose()

    # Image 1 — before first <p>
    first_p = soup.find("p")
    if first_p and img1_url:
        tag = soup.new_tag("img", src=img1_url, loading="lazy", decoding="async")
        first_p.insert_before(tag)

    # Image 2 — before 4th <h2>
    if img2_url:
        h2_list = soup.find_all("h2")
        target = h2_list[3] if len(h2_list) >= 4 else (soup.find("body") or soup)
        tag2 = soup.new_tag("img", src=img2_url, loading="lazy", decoding="async")
        target.insert_before(tag2)

    body = soup.find("body")
    return body.decode_contents() if body else str(soup)


def extract_and_remove_title(html: str) -> tuple[str, str]:
    title, soup = _parse_and_extract_title(html)
    body = soup.find("body")
    content = body.decode_contents() if body else str(soup)
    return title, content


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
    site_config: dict,
    title: str,
    alt_text: str,
    image_slug: str | None = None,
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
        base_url = _wp_rest_base(site_config)
        auth = (site_config["wp_username"], site_config["wp_password"])
        session = _wp_session(auth)

        ru = session.post(
            f"{base_url}/media", data=webp_data, timeout=60,
            headers={"Content-Type": "image/webp", "Content-Disposition": f'attachment; filename="{filename}"'},
        )
        ru.raise_for_status()
        body = ru.json()
        attachment_id = body["id"]
        img_url = body.get("source_url", "")

        session.post(
            f"{base_url}/media/{attachment_id}", timeout=30,
            json={"title": title, "caption": title, "alt_text": alt_text or title, "slug": title_slug},
        )

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

    base_url = _wp_rest_base(wp_url)
    session = _wp_session((username, password))
    r = session.post(
        f"{base_url}/media", data=file_content, timeout=60,
        headers={"Content-Type": mime_type, "Content-Disposition": f'attachment; filename="{filename}"'},
    )
    r.raise_for_status()
    body = r.json()
    attachment_id = body["id"]
    img_url = body.get("source_url", "")

    session.post(
        f"{base_url}/media/{attachment_id}", timeout=30,
        json={"title": title, "caption": title, "alt_text": title},
    )

    return {"id": attachment_id, "url": img_url}


def create_pin_post(
    wp_url: str,
    username: str,
    password: str,
    title: str,
    media_id: int,
    post_status: str = "publish",
) -> dict:
    """Create a blog post with the pin image as featured image."""
    base_url = _wp_rest_base(wp_url)
    r = _wp_session((username, password)).post(
        f"{base_url}/posts", timeout=30,
        json={"title": title, "content": "", "status": post_status, "featured_media": media_id},
    )
    r.raise_for_status()
    body = r.json()
    post_id = body["id"]
    post_url = body.get("link") or f"{base_url.replace('/wp-json/wp/v2', '')}/?p={post_id}"
    return {"post_id": post_id, "post_url": post_url}


def _update_alt_text(attachment_id: str, alt_text: str, site_config: dict, log: Callable):
    try:
        rest_url = site_config["wp_url"].replace("xmlrpc.php", "") + "wp-json/wp/v2"
        auth = (site_config["wp_username"], site_config["wp_password"])
        r = requests.post(f"{rest_url}/media/{attachment_id}", auth=auth, json={"alt_text": alt_text}, timeout=30)
        if r.status_code == 200:
            log("Alt text updated")
    except Exception as e:
        log(f"Error updating alt text: {e}")


def _normalize_recipe_for_wprm(data: dict) -> dict:
    """
    Convert ingredients_flat / instructions_flat (WPRM flat uid/group/type format,
    OR plain-string arrays) into the grouped 'ingredients' / 'instructions' format
    that the WPRM REST API endpoint /wp-json/wp/v2/wprm_recipe requires.
    """
    # ── ingredients ───────────────────────────────────────────────────────────
    flat_ing = data.pop("ingredients_flat", None)
    if flat_ing and not data.get("ingredients"):
        groups: list = []
        current: dict = {"name": "", "ingredients": []}
        for item in (flat_ing if isinstance(flat_ing, list) else []):
            if isinstance(item, dict):
                t = item.get("type", "")
                if t == "group":
                    if current["ingredients"]:
                        groups.append(current)
                    current = {"name": item.get("name", ""), "ingredients": []}
                elif t == "ingredient":
                    current["ingredients"].append({
                        "amount": str(item.get("amount", "")),
                        "unit": str(item.get("unit", "")),
                        "name": str(item.get("name", "")),
                        "notes": str(item.get("notes", "")),
                    })
            elif isinstance(item, str) and item.strip():
                # Fallback: plain string — parse "1 cup flour" loosely
                current["ingredients"].append({"amount": "", "unit": "", "name": item.strip(), "notes": ""})
        if current["ingredients"]:
            groups.append(current)
        if groups:
            data["ingredients"] = groups

    # ── instructions ──────────────────────────────────────────────────────────
    flat_ins = data.pop("instructions_flat", None)
    if flat_ins and not data.get("instructions"):
        groups = []
        current = {"name": "", "instructions": []}
        for item in (flat_ins if isinstance(flat_ins, list) else []):
            if isinstance(item, dict):
                t = item.get("type", "")
                if t == "group":
                    if current["instructions"]:
                        groups.append(current)
                    current = {"name": item.get("name", ""), "instructions": []}
                elif t == "instruction":
                    current["instructions"].append({"name": "", "text": str(item.get("text", ""))})
            elif isinstance(item, str) and item.strip():
                current["instructions"].append({"name": "", "text": item.strip()})
        if current["instructions"]:
            groups.append(current)
        if groups:
            data["instructions"] = groups

    # ── nutrition: strip unit strings → keep only numeric part ───────────────
    nutrition = data.get("nutrition", {})
    if isinstance(nutrition, dict):
        for key, val in nutrition.items():
            if isinstance(val, str) and val.strip():
                # Extract leading number from strings like "350 kcal", "50 g"
                import re as _re
                m = _re.match(r"^\s*([\d.]+)", val)
                nutrition[key] = m.group(1) if m else val
        data["nutrition"] = nutrition

    return data


def add_recipe(
    recipe_data: dict,
    site_config: dict,
    image_url: str | None = None,
    author: str | None = None,
    image_id: int | str | None = None,
    log: Callable[[str], None] | None = None,
) -> int | None:
    _log = log or print
    try:
        base_url = _wp_rest_base(site_config)
        auth = (site_config["wp_username"], site_config["wp_password"])

        # Normalize flat format → grouped format that WPRM REST API expects
        recipe_data = _normalize_recipe_for_wprm(recipe_data)

        if image_url:
            recipe_data["image_url"] = image_url
            recipe_data["pin_image_url"] = image_url
        # WPRM needs the WordPress media attachment ID to display the image in the recipe card
        if image_id:
            recipe_data["image_id"] = int(image_id)
        if author:
            recipe_data["author_name"] = author

        r = _wp_session(auth).post(f"{base_url}/wprm_recipe", json={"recipe": recipe_data}, timeout=30)
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
    seo_title: str = "",
    log: Callable[[str], None] | None = None,
):
    _log = log or print
    try:
        base_url = _wp_rest_base(site_config)
        auth = (site_config["wp_username"], site_config["wp_password"])
        meta = {}
        if seo_title:
            meta["rank_math_title"] = seo_title
        if focus_keyword:
            meta["rank_math_focus_keyword"] = focus_keyword
        if seo_description:
            meta["rank_math_description"] = seo_description
        if meta:
            r = _wp_session(auth).post(f"{base_url}/posts/{post_id}", json={"meta": meta}, timeout=30)
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
    if project == "V2":
        return _create_post_v2(row, site_config, row_index, worksheet, _log)
    else:
        return _create_post_v1(row, site_config, row_index, worksheet, _log)


def _create_post_v1(row, site_config, row_index, worksheet, log):
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

    img_id, img_url = upload_image(image_urls, site_config, title, focus_kw, log=log)

    recipe_id = None
    recipe_data = validate_recipe_json(recipe_json_str)
    if recipe_data:
        recipe_id = add_recipe(recipe_data, site_config, img_url, author, log=log)

    if recipe_id:
        content += f"\n[wprm-recipe id={recipe_id}]"

    base_url = _wp_rest_base(site_config)
    auth = (site_config["wp_username"], site_config["wp_password"])
    post_payload: dict = {
        "title": title, "content": content, "slug": slug,
        "status": "publish" if publish_date else "draft",
    }
    if img_id:
        post_payload["featured_media"] = int(img_id)
    if category:
        cat_id = _get_or_create_term(category, "categories", base_url, auth, log)
        if cat_id:
            post_payload["categories"] = [cat_id]
    if publish_date:
        for fmt in ("%Y-%m-%d", "%Y/%m/%d %H:%M"):
            try:
                post_payload["date_gmt"] = datetime.strptime(publish_date, fmt).strftime("%Y-%m-%dT%H:%M:%S")
                break
            except ValueError:
                continue

    rp = requests.post(f"{base_url}/posts", auth=auth, json=post_payload, timeout=30)
    rp.raise_for_status()
    body = rp.json()
    post_id = body["id"]
    domain = site_config.get("domain", "")
    permalink = body.get("link") or f"{domain}/{slug}/"

    if worksheet:
        worksheet.update_cell(row_index, 10, permalink)

    log(f"Post created (ID: {post_id}) - {permalink}")
    return post_id


def _create_post_v2(row, site_config, row_index, worksheet, log):
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

    img_id, img_url = upload_image(image_urls, site_config, title, focus_kw, image_slug=image_slug, log=log)

    recipe_id = None
    recipe_data = validate_recipe_json(recipe_json_str)
    if recipe_data:
        recipe_id = add_recipe(recipe_data, site_config, img_url, author, log=log)

    if pin_image_url:
        content = insert_image_after_paragraph(content, pin_image_url, focus_kw)

    if recipe_id:
        content += f"\n[wprm-recipe id={recipe_id}]"

    base_url = _wp_rest_base(site_config)
    auth = (site_config["wp_username"], site_config["wp_password"])
    post_payload: dict = {
        "title": title, "content": content, "slug": slug,
        "status": "publish" if publish_date else "draft",
    }
    if img_id:
        post_payload["featured_media"] = int(img_id)
    if category:
        cat_id = _get_or_create_term(category, "categories", base_url, auth, log)
        if cat_id:
            post_payload["categories"] = [cat_id]
    if publish_date:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M"):
            try:
                post_payload["date_gmt"] = datetime.strptime(publish_date, fmt).strftime("%Y-%m-%dT%H:%M:%S")
                break
            except ValueError:
                continue

    rp = requests.post(f"{base_url}/posts", auth=auth, json=post_payload, timeout=30)
    rp.raise_for_status()
    body = rp.json()
    post_id = body["id"]
    domain = site_config.get("domain", "")
    permalink = body.get("link") or f"{domain}/{slug}/"

    if worksheet:
        worksheet.update_cell(row_index, 11, permalink)

    if focus_kw or seo_desc:
        set_rank_math_meta(post_id, focus_kw, seo_desc, site_config, log=log)

    log(f"Post created (ID: {post_id}) - {permalink}")
    return post_id
