import time
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from wordpress_xmlrpc import Client, WordPressPost
from wordpress_xmlrpc.methods.posts import NewPost, EditPost
from wordpress_xmlrpc.methods.media import UploadFile
import requests
from bs4 import BeautifulSoup
import json
import re
from datetime import datetime
from slugify import slugify
import base64
from PIL import Image
import io

import sys

START_ROW = int(sys.argv[1]) if len(sys.argv) > 1 else 1

# =========================
# GLOBAL CONFIG
# =========================

SERVICE_ACCOUNT_FILE = 'serviceaccounts.json'
SPREADSHEET_ID = '15shOy7333VvZlS87jZqmxRg0-LB9AiTmzngRWnOsdRc'


load_dotenv()

SITES_CONFIG = {
    "lorachef.com": {
        "WORDPRESS_URL": "https://www.lorachef.com/xmlrpc.php",
        "WORDPRESS_USERNAME": os.getenv("WP_LORACHEF_USER", ""),
        "WORDPRESS_PASSWORD": os.getenv("WP_LORACHEF_PASS", ""),
        "WORDPRESS_DOMAIN": "https://www.lorachef.com",
        "SHEET_NAME": "lorachef.com"
    },
    "oviarecipes.com": {
        "WORDPRESS_URL": "https://www.oviarecipes.com/xmlrpc.php",
        "WORDPRESS_USERNAME": os.getenv("WP_OVIARECIPES_USER", ""),
        "WORDPRESS_PASSWORD": os.getenv("WP_OVIARECIPES_PASS", ""),
        "WORDPRESS_DOMAIN": "https://www.oviarecipes.com",
        "SHEET_NAME": "oviarecipes.com"
    },
    "chefboiardi.com": {
        "WORDPRESS_URL": "https://www.chefboiardi.com/xmlrpc.php",
        "WORDPRESS_USERNAME": os.getenv("WP_CHEFBOIARDI_USER", ""),
        "WORDPRESS_PASSWORD": os.getenv("WP_CHEFBOIARDI_PASS", ""),
        "WORDPRESS_DOMAIN": "https://www.chefboiardi.com",
        "SHEET_NAME": "chefboiardi.com"
    },
    "chefandpress.com": {
        "WORDPRESS_URL": "https://www.chefandpress.com/xmlrpc.php",
        "WORDPRESS_USERNAME": os.getenv("WP_CHEFANDPRESS_USER", ""),
        "WORDPRESS_PASSWORD": os.getenv("WP_CHEFANDPRESS_PASS", ""),
        "WORDPRESS_DOMAIN": "https://www.chefandpress.com",
        "SHEET_NAME": "chefandpress.com"
    }
}

# =========================
# GOOGLE SHEETS
# =========================

def connect_to_google_sheets(sheet_name):
    scope = [
        'https://spreadsheets.google.com/feeds',
        'https://www.googleapis.com/auth/drive'
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_name(
        SERVICE_ACCOUNT_FILE, scope
    )
    client = gspread.authorize(creds)
    return client.open_by_key(SPREADSHEET_ID).worksheet(sheet_name)

# =========================
# HELPERS
# =========================

def extract_and_remove_title(html):
    if not html:
        return "New Recipe Post", ""
    soup = BeautifulSoup(html, "html.parser")
    title = "New Recipe Post"
    h1 = soup.find("h1")
    if h1:
        title = h1.get_text(strip=True)
        h1.decompose()
    return title, str(soup)

def get_first_valid_image_url(text):
    if not text:
        return None
    urls = re.split(r'[\s,\n]+', text)
    for url in urls:
        if url.startswith("http"):
            return url
    return None

def convert_to_webp(image_bytes):
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode == "RGBA":
        img = img.convert("RGB")
    out = io.BytesIO()
    img.save(out, format="WEBP", quality=85)
    return out.getvalue()

def validate_recipe_json(raw):
    try:
        raw = raw.strip().replace('\\"', '"')
        if raw.startswith('"'):
            raw = raw[1:-1]
        return json.loads(raw)
    except:
        return None

# =========================
# WORDPRESS
# =========================

def upload_image(image_urls, wp, title, alt_text):
    url = get_first_valid_image_url(image_urls)
    if not url:
        return None, None

    r = requests.get(url, timeout=30)
    image_data = convert_to_webp(r.content)

    filename = f"{slugify(title)}.webp"
    data = {
        'name': filename,
        'type': 'image/webp',
        'bits': image_data
    }

    res = wp.call(UploadFile(data))
    attachment_id = res["id"]

    wp.call(EditPost(attachment_id, {
        "post_title": title,
        "post_excerpt": alt_text
    }))

    return attachment_id, res["url"]

def add_recipe(recipe, site, image_url, author):
    api = site["WORDPRESS_URL"].replace("xmlrpc.php", "wp-json/wp/v2/wprm_recipe")
    token = base64.b64encode(
        f'{site["WORDPRESS_USERNAME"]}:{site["WORDPRESS_PASSWORD"]}'.encode()
    ).decode()

    if image_url:
        recipe["image_url"] = image_url
        recipe["pin_image_url"] = image_url
    if author:
        recipe["author_name"] = author

    r = requests.post(
        api,
        headers={
            "Authorization": f"Basic {token}",
            "Content-Type": "application/json"
        },
        json={"recipe": recipe},
        timeout=30
    )
    r.raise_for_status()
    return r.json().get("id")

# =========================
# MAIN POST CREATION
# =========================

def create_post(row, worksheet, row_index, site):
    wp = Client(
        site["WORDPRESS_URL"],
        site["WORDPRESS_USERNAME"],
        site["WORDPRESS_PASSWORD"]
    )

    image_urls = row[0] if len(row) > 0 else ""
    html = row[1] if len(row) > 1 else ""
    recipe_json = row[2] if len(row) > 2 else ""
    category = row[3] if len(row) > 3 else ""
    publish_date = row[4] if len(row) > 4 else ""
    focus_kw = row[5] if len(row) > 5 else ""
    seo_desc = row[6] if len(row) > 6 else ""
    author = row[8] if len(row) > 8 else None

    title, content = extract_and_remove_title(html)
    slug = slugify(focus_kw or title)

    img_id, img_url = upload_image(image_urls, wp, title, focus_kw)

    recipe_id = None
    recipe_data = validate_recipe_json(recipe_json)
    if recipe_data:
        recipe_id = add_recipe(recipe_data, site, img_url, author)

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
        except:
            pass

    post_id = wp.call(NewPost(post))

    permalink = f'{site["WORDPRESS_DOMAIN"]}/{slug}/'
    worksheet.update_cell(row_index, 10, permalink)

    return post_id

# =========================
# RUN ALL SITES
# =========================

def main():
    print("🚀 Multi-site script started")

    for site_name, site in SITES_CONFIG.items():
        print(f"\n🌍 SITE: {site_name}")
        sheet = connect_to_google_sheets(site["SHEET_NAME"])
        rows = sheet.get_all_values()

        for i, row in enumerate(rows[START_ROW:], start=START_ROW + 1):
            if not any(row[:3]):
                continue
            try:
                pid = create_post(row, sheet, i, site)
                print(f"✅ Post {pid} created")
                time.sleep(2)
            except Exception as e:
                print(f"❌ Row {i} failed: {e}")

    print("🏁 DONE")

if __name__ == "__main__":
    main()
