#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import time, os, re, mimetypes, requests, io, json, base64, html
import gspread
import random   #  ← NEW
from datetime import datetime
from bs4 import BeautifulSoup
from slugify import slugify
from PIL import Image                                     ### NEW (Pillow)
from oauth2client.service_account import ServiceAccountCredentials
from wordpress_xmlrpc import Client, WordPressPost, WordPressTerm
from wordpress_xmlrpc.methods.posts import NewPost, EditPost
from wordpress_xmlrpc.methods.media import UploadFile
from wordpress_xmlrpc.methods.taxonomies import GetTerms, NewTerm
from datetime import datetime, timedelta
from wordpress_xmlrpc.methods.posts import GetPost

def random_date_within_last_6_months() -> datetime:
    """
    Retourne un objet datetime situé aléatoirement entre maintenant
    et six mois en arrière (≈ 182 jours). On garde l’heure courante
    pour éviter d’obtenir minuit pile.
    """
    now = datetime.now()
    six_months_ago = now - timedelta(days=182)
    # durée totale en secondes entre les deux bornes
    span = (now - six_months_ago).total_seconds()
    # piocher un offset aléatoire dans cet intervalle
    random_offset = random.uniform(0, span)
    return six_months_ago + timedelta(seconds=random_offset)
# ─── CONFIG ──────────────────────────────────────────────────────────────
WORDPRESS_URL    = "https://www.winsomerecipes.com/xmlrpc.php"
WORDPRESS_DOMAIN = "https://www.winsomerecipes.com/"

# three possible log‑ins – replace with the real credentials
WP_ACCOUNTS = [
    ("John",  "eZHg 9mv0 YeS2 ebMw PB0U vqME"),  
    ("Emelia", "vEXV en2d TsP5 3wJO okYP 2W8i"),  
    ("recipesaitouahmane@gmail.com", "7Njb Cuid Igho R5i6 rog3 nngW"),
    ("abdowahman57", "3fjj 6Qi3 5Wkd BGof Ic7I TRcw"),  
]

SERVICE_ACCOUNT_FILE = "serviceaccounts.json"
SPREADSHEET_ID       = "1BswVAS_pUuB1pkF6_iNHuQ5yOZbBRSQInFN_YEFflLE"
SHEET_NAME           = "wordpress"
# ─────────────────────────────────────────────────────────────────────────

# ─── GOOGLE SHEETS ───────────────────────────────────────────────────────
def connect_sheet():
    scope = ["https://spreadsheets.google.com/feeds",
             "https://www.googleapis.com/auth/drive"]
    creds = ServiceAccountCredentials.from_json_keyfile_name(
        SERVICE_ACCOUNT_FILE, scope)
    return gspread.authorize(creds).open_by_key(SPREADSHEET_ID).worksheet(SHEET_NAME)

# ─── BASIC HTML UTILITIES ────────────────────────────────────────────────
def strip_and_extract_title(html_in: str):
    soup = BeautifulSoup(html_in or "", "html.parser")
    h = soup.find(["h1", "h2"])
    title = h.get_text(strip=True) if h else "Neues Rezept"
    if h:
        h.decompose()
    return title, soup                                                ### CHANGED (return soup)

# ─── IMAGE HELPERS (download → webp → upload) ───────────────────────────
def first_valid_url(cell):
    """Return first non‑empty http(s) URL from a cell string."""
    if not cell:
        return None
    for u in re.split(r"[,\s\n]+", cell.strip()):
        if u and u.startswith(("http://", "https://")):
            return u
    return None


def fetch_image(url):
    headers = {"User-Agent": "Mozilla/5.0"}
    r = requests.get(url, headers=headers, timeout=25)
    r.raise_for_status()
    return r.content, os.path.splitext(url.split("?")[0])[1] or ".jpg"


def convert_to_webp(img_bytes):
    try:
        img = Image.open(io.BytesIO(img_bytes))
        if img.mode == "RGBA":
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=85)
        return out.getvalue(), ".webp", "image/webp"
    except Exception:
        # fallback – keep original
        return img_bytes, ".jpg", "image/jpeg"


def upload_image_to_wp(img_bytes, ext, mime, wp, title_slug, suffix=""):
    data = {
        "name": f"{title_slug}{suffix}{ext}",
        "type": mime,
        "bits": img_bytes,
        "overwrite": True,
    }
    att = wp.call(UploadFile(data))
    return att["id"], att["url"]

# ─── RECIPE JSON CLEANUP (unchanged) ─────────────────────────────────────
def validate_recipe_json(txt: str):
    if not txt or not isinstance(txt, str):
        return None
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        raw = txt.strip()
        if raw[:1] in "\"'" and raw[-1:] in "\"'":
            raw = raw[1:-1]
        while '""' in raw:
            raw = raw.replace('""', '"')
        raw = raw.replace('\r', '').replace('\n', ' ')
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            print("❌ JSON illisible :", e)
            return None

def add_recipe_to_wordpress(recipe_data, image_url=None,
                            author=None, wp_creds=None):
    """
    wp_creds → tuple (username, password) for the account that is posting
    """
    try:
        if not wp_creds:
            raise ValueError("missing credentials")

        wp_user, wp_pass = wp_creds
        api = WORDPRESS_URL.replace("xmlrpc.php", "wp-json/wp/v2/wprm_recipe")

        token = base64.b64encode(f"{wp_user}:{wp_pass}".encode()).decode()
        headers = {
            "Authorization": f"Basic {token}",
            "Content-Type":  "application/json",
        }

        if image_url:
            recipe_data["image_url"]     = image_url
            recipe_data["pin_image_url"] = image_url
        if author:
            recipe_data["author_name"]   = author

        r = requests.post(api, headers=headers,
                          json={"recipe": recipe_data}, timeout=30)
        r.raise_for_status()
        return r.json().get("id")           # success
    except Exception as e:
        print("Recipe POST failed:", e)
        return None

# ─── INSERT IMAGES INSIDE ARTICLE ───────────────────────────────────────
def inject_images_into_html(soup, img1_url, img2_url):
    # a) first image before first <p>
    first_p = soup.find("p")
    if first_p and img1_url:
        tag = soup.new_tag("img", src=img1_url, loading="lazy", decoding="async")
        first_p.insert_before(tag)

    # b) second image before 4‑th <h2>
    if img2_url:
        h2_list = soup.find_all("h2")
        if len(h2_list) >= 4:
            target = h2_list[3]
        else:
            target = soup.body or soup
        tag2 = soup.new_tag("img", src=img2_url, loading="lazy", decoding="async")
        target.insert_before(tag2)

    return str(soup)

# ─── ROW PROCESSOR ──────────────────────────────────────────────────────
def process_row(row, idx, ws):
    # columns: A img1 | B img2 | C title | D desc | E cat | F HTML | G slug | H focusKW | I tags | J JSON
    img1_cell  = row[0] if len(row) > 0 else ""
    img2_cell  = row[1] if len(row) > 1 else ""
    seo_title  = row[2] if len(row) > 2 else ""
    meta_desc  = row[3] if len(row) > 3 else ""
    category   = row[4] if len(row) > 4 else ""
    html_raw   = row[5] if len(row) > 5 else ""
    slug_txt   = row[6] if len(row) > 6 else ""
    focus_kw   = row[7] if len(row) > 7 else ""
    tags_raw   = row[8] if len(row) > 8 else ""
    json_raw   = row[9] if len(row) > 9 else ""

    # ---------- Basic setup ----------
    title_fallback, soup = strip_and_extract_title(html_raw)
    title   = seo_title.strip() or title_fallback
    # >>> PICK ONE OF THE THREE ACCOUNTS AT RANDOM  ------------------- ▼
    wp_user, wp_pass = random.choice(WP_ACCOUNTS)          # NEW
    wp = Client(WORDPRESS_URL, wp_user, wp_pass)           # CHANGED
    # ---------------------------------------------------------------- ▲
    slug_id = slugify(slug_txt or title)
    featured_id = featured_url = inline2_url = None

    # ---------- image 1 (featured + inline top) ----------
    img1_url = first_valid_url(img1_cell)
    if img1_url:
        raw, _ = fetch_image(img1_url)
        webp, ext, mime = convert_to_webp(raw)
        featured_id, featured_url = upload_image_to_wp(webp, ext, mime, wp, slug_id, "-1")

    # ---------- image 2 (inline before 4th h2) ----------
    img2_url = first_valid_url(img2_cell)
    if img2_url:
        raw2, _ = fetch_image(img2_url)
        webp2, ext2, mime2 = convert_to_webp(raw2)
        _, inline2_url = upload_image_to_wp(webp2, ext2, mime2, wp, slug_id, "-2")

    # ---------- inject images into HTML ----------
    body_html = inject_images_into_html(soup, featured_url, inline2_url)

    # ---------- recipe shortcode ----------
    recipe_id = None
    if json_raw:
        data_ok = validate_recipe_json(json_raw)
        if data_ok:
            recipe_id = add_recipe_to_wordpress(
                data_ok,
                featured_url,
                author=None,
                wp_creds=(wp_user, wp_pass)     # ← NEW ARG
            )
            if recipe_id:
                body_html += f"\n[wprm-recipe id={recipe_id}]\n"

    # ---------- random publish date ----------
    publish_date = random_date_within_last_6_months()

    # ---------- build WP post ----------
    post = WordPressPost()
    post.title          = title
    post.content        = body_html
    post.post_status    = "publish"       # ✅ publish immediately
    post.date           = publish_date    # keep your random date
    post.comment_status = "open"          # ✅ allow comments
    post.ping_status    = "closed"        # ✅ disable pingbacks/trackbacks
    if slug_txt:
        post.slug = slug_id
    # ---------- categories ----------
    if category:
        # allow several categories in the same cell, separated by comma
        cat_list = [c.strip() for c in re.split(r"[,/|]", category) if c.strip()]
        if cat_list:
            post.terms_names = {"category": cat_list}
    if tags_raw:
        tags = [t.strip() for t in tags_raw.split(",") if t.strip()]
        post.terms_names = post.terms_names or {}
        post.terms_names["post_tag"] = tags
    if featured_id:
        post.thumbnail = str(featured_id)

    post_id = wp.call(NewPost(post))
    print(f"📝 Post {post_id} published")

    # fetch the post to get the canonical URL (not a manual slug URL)
    published_post = wp.call(GetPost(post_id))
    permalink = getattr(published_post, "link", None) or f"{WORDPRESS_DOMAIN}/{published_post.slug}/"

    # ---------- Yoast fields ----------
    yoast = WordPressPost()
    yoast.custom_fields = [
        {"key": "_yoast_wpseo_title",    "value": seo_title or title},
        {"key": "_yoast_wpseo_metadesc", "value": meta_desc},
        {"key": "_yoast_wpseo_focuskw",  "value": focus_kw},
    ]
    wp.call(EditPost(post_id, yoast))
    print("🔧 Yoast metadata saved")

    # ---------- real title if SEO title differs ----------
    if seo_title.strip():
        fix = WordPressPost()
        fix.title = seo_title.strip()
        wp.call(EditPost(post_id, fix))

    # ---------- permalink back to sheet ----------
    # ---------- permalink back to sheet (real URL from WP) ----------
    ws.update_cell(idx, 11, permalink)          # column K (1-based)
    print(f"🔗 Permalink saved: {permalink}\n")
    return post_id

# ─── MAIN LOOP ───────────────────────────────────────────────────────────
def main():
    ws = connect_sheet()
    rows = ws.get_all_values()
    if len(rows) < 2:
        print("Sheet empty")
        return

    for i, row in enumerate(rows[1:], start=2):
        if not (len(row) > 5 and row[5].strip()):
            print(f"Row {i} skipped (no article HTML)")
            continue
        try:
            process_row(row, i, ws)
        except Exception as e:
            print("❌ Error row", i, ":", e)
        time.sleep(3)

if __name__ == "__main__":
    main()
