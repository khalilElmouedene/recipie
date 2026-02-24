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

# --- CONFIGURATIONS ---
# Store all configurations in a dictionary for easy iteration
CONFIGS = {
    "lorachef.com": {
        "WORDPRESS_URL": 'https://www.lorachef.com/xmlrpc.php',
        "WORDPRESS_USERNAME": 'lora',
        "WORDPRESS_PASSWORD": 'emaC ayhy 8RJq lyOO hXS5 Q9pWX',
        "WORDPRESS_DOMAIN": 'https://www.lorachef.com',
        "SHEET_NAME": 'lorachef.com'
    },
    "oviarecipes.com": {
        "WORDPRESS_URL": 'https://www.oviarecipes.com/xmlrpc.php',
        "WORDPRESS_USERNAME": 'xweexsalawi@gmail.com',
        "WORDPRESS_PASSWORD": 'dl7K r8eB 9FMl SoyQ ZdHx AYFCX',
        "WORDPRESS_DOMAIN": 'https://www.oviarecipes.com',
        "SHEET_NAME": 'oviarecipes.com'
    },
    "chefboiardi.com": {
        "WORDPRESS_URL": 'https://www.chefboiardi.com/xmlrpc.php',
        "WORDPRESS_USERNAME": 'boiardi',
        "WORDPRESS_PASSWORD": '0UdH JXVS olZ9 TsS4 q2K8 v5r4X',
        "WORDPRESS_DOMAIN": 'https://www.chefboiardi.com',
        "SHEET_NAME": 'chefboiardi.com'
    },
    "chefandpress.com": {
        "WORDPRESS_URL": 'https://www.chefandpress.com/xmlrpc.php',
        "WORDPRESS_USERNAME": 'xweexsalawi@gmail.com',
        "WORDPRESS_PASSWORD": '40Hz QAVY 05Zs OWII SvqD K401X',
        "WORDPRESS_DOMAIN": 'https://www.chefandpress.com',
        "SHEET_NAME": 'chefandpress.com'
    }
}

# Google Sheets Configuration (Constant across all)
SERVICE_ACCOUNT_FILE = 'serviceaccounts.json'
SPREADSHEET_ID = '1xGTpSA-D0ucuKaydQ5e7rMB_I2bM1v_Vlw5FC88y1pc'
# Script Configuration



# --- UTILITY FUNCTIONS (Modified to accept config) ---

def connect_to_google_sheets(sheet_name):
    """Authenticate with Google Sheets API"""
    scope = ['https://spreadsheets.google.com/feeds',
             'https://www.googleapis.com/auth/drive']
    creds = ServiceAccountCredentials.from_json_keyfile_name(SERVICE_ACCOUNT_FILE, scope)
    client = gspread.authorize(creds)
    return client.open_by_key(SPREADSHEET_ID).worksheet(sheet_name)


def extract_and_remove_title(html_content):
    # ... (same as original)
    """Extract title from HTML content and remove it from the content"""
    if not html_content or not isinstance(html_content, str):
        return "New Recipe Post", ""

    soup = BeautifulSoup(html_content, 'html.parser')
    title = "New Recipe Post"

    h1 = soup.find('h1')
    if h1:
        title = h1.get_text().strip()
        h1.decompose()

    if title == "New Recipe Post":
        h2 = soup.find('h2')
        if h2:
            title = h2.get_text().strip()
            h2.decompose()

    return title, str(soup)


def update_attachment_alt_text(wp_client, attachment_id, alt_text, wp_url, wp_user, wp_pass):
    """Update the alt text for an attachment"""
    try:
        wp_rest_url = wp_url.replace('xmlrpc.php', '') + 'wp-json/wp/v2'
        auth = (wp_user, wp_pass)

        response = requests.post(
            f"{wp_rest_url}/media/{attachment_id}",
            auth=auth,
            json={"alt_text": alt_text},
            timeout=30
        )

        if response.status_code == 200:
            print("✅ Alt text updated via REST API")
            return True

        # Try updating via custom fields if first REST call fails
        update_data = {
            'meta': {
                '_wp_attachment_image_alt': alt_text
            }
        }

        response = requests.post(
            f"{wp_rest_url}/media/{attachment_id}",
            auth=auth,
            json=update_data,
            timeout=30
        )

        if response.status_code == 200:
            print("✅ Alt text updated via custom fields")
            return True

        print(f"❌ Failed to update alt text (status {response.status_code})")
        return False

    except Exception as e:
        print(f"❌ Error updating alt text: {str(e)}")
        return False


def get_first_valid_image_url(image_urls):
    # ... (same as original)
    """Extract first valid image URL from column A content"""
    if not image_urls:
        return None

    # Handle case where input might be a list or string
    if isinstance(image_urls, str):
        # Split by whitespace, comma, or newline
        urls = re.split(r'[\s,\n]+', image_urls.strip())
    elif isinstance(image_urls, list):
        urls = [url.strip() for url in image_urls if url and isinstance(url, str)]
    else:
        return None

    # Check each URL
    for url in urls:
        url = url.strip()
        if not url:
            continue

        # Basic URL validation
        if not (url.startswith('http://') or url.startswith('https://')):
            # Try to prepend https:// if missing
            if url.startswith('www.'):
                url = 'https://' + url
            else:
                continue

        # Check for common image extensions
        if any(url.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']):
            return url

        # If no extension, try to check the URL anyway
        try:
            response = requests.head(url, timeout=5)
            if response.status_code == 200:
                content_type = response.headers.get('Content-Type', '')
                if content_type.startswith('image/'):
                    return url
        except:
            continue

    return None


def convert_to_webp(image_data):
    # ... (same as original)
    """Convert image data to WebP format"""
    try:
        img = Image.open(io.BytesIO(image_data))

        # Convert to RGB if image is in RGBA mode
        if img.mode == 'RGBA':
            img = img.convert('RGB')

        # Convert to WebP
        output = io.BytesIO()
        img.save(output, format='WEBP', quality=85)
        return output.getvalue()
    except Exception as e:
        print(f"❌ Error converting image to WebP: {str(e)}")
        return None


def upload_image_to_wordpress(image_urls, wp_client, title, alt_text, image_slug, wp_url, wp_user, wp_pass):
    """Upload featured image to WordPress as WebP"""
    image_url = get_first_valid_image_url(image_urls)
    if not image_url:
        print(f"❌ No valid image URL found in: {image_urls[:100]}...")
        return None, None

    try:
        print(f"🖼️ Downloading image from {image_url}")
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(image_url, headers=headers, stream=True, timeout=30)
        response.raise_for_status()

        # Convert image to WebP
        image_data = response.content
        webp_data = convert_to_webp(image_data)
        if not webp_data:
            print("⚠️ Couldn't convert image to WebP, uploading original format")
            webp_data = image_data

        title_slug = image_slug if image_slug else slugify(title)
        new_filename = f"{title_slug}.webp"
        mime_type = 'image/webp'

        print(f"📤 Uploading image as {new_filename}")
        data = {
            'name': new_filename,
            'type': mime_type,
            'bits': webp_data,
            'overwrite': True
        }

        upload_response = wp_client.call(UploadFile(data))
        attachment_id = upload_response['id']
        img_url = upload_response['url']

        print(f"🔄 Updating attachment metadata (ID: {attachment_id})")
        attachment = {
            'post_title': title,
            'post_excerpt': title,
            'post_content': title,
            'post_name': title_slug
        }
        wp_client.call(EditPost(attachment_id, attachment))

        time.sleep(1)

        if alt_text:
            update_attachment_alt_text(wp_client, attachment_id, alt_text, wp_url, wp_user, wp_pass)

        print(f"✅ Image uploaded successfully (ID: {attachment_id}, URL: {img_url})")
        return attachment_id, img_url

    except requests.exceptions.RequestException as e:
        print(f"❌ Network error uploading image: {str(e)}")
    except Exception as e:
        print(f"❌ Unexpected error uploading image: {str(e)}")

    return None, None


def validate_recipe_json(recipe_json):
    # ... (same as original)
    """Validate and clean recipe JSON data"""
    if not recipe_json or not isinstance(recipe_json, str):
        return None

    try:
        # Clean the JSON string
        recipe_json = recipe_json.strip()
        if recipe_json.startswith('"') and recipe_json.endswith('"'):
            recipe_json = recipe_json[1:-1]
        recipe_json = recipe_json.replace('\\"', '"')

        # Parse the JSON
        recipe_data = json.loads(recipe_json)
        return recipe_data
    except json.JSONDecodeError as e:
        print(f"❌ Invalid recipe JSON: {str(e)}")
        print(f"Problematic JSON: {recipe_json[:200]}...")
        return None


def add_recipe_to_wordpress(recipe_data, image_url, author_name, wp_url, wp_user, wp_pass):
    """Add recipe to WP Recipe Maker"""
    if not recipe_data:
        return None

    try:
        api_url = wp_url.replace('xmlrpc.php', 'wp-json/wp/v2/wprm_recipe')
        token = base64.b64encode(f"{wp_user}:{wp_pass}".encode()).decode()

        headers = {
            'Authorization': f'Basic {token}',
            'Content-Type': 'application/json',
        }

        if image_url:
            recipe_data['image_url'] = image_url
            recipe_data['pin_image_url'] = image_url

        if author_name:
            recipe_data['author_name'] = author_name

        payload = {"recipe": recipe_data}

        print("📝 Sending recipe data to WP Recipe Maker...")
        response = requests.post(api_url, headers=headers, json=payload, timeout=30)
        response.raise_for_status()

        result = response.json()
        print(f"✅ Recipe created successfully (ID: {result.get('id')})")
        return result

    except Exception as e:
        print(f"❌ Error adding recipe: {str(e)}")
        if 'response' in locals():
            print(f"Response: {response.text}")
        return None


def set_rank_math_seo_meta(post_id, focus_keyword, seo_description, wp_url, wp_user, wp_pass):
    """Update Rank Math SEO meta"""
    try:
        if not post_id:
            print("⚠️ No post ID provided for SEO meta")
            return

        api_url = wp_url.replace('xmlrpc.php', f'wp-json/wp/v2/posts/{post_id}')
        token = base64.b64encode(f"{wp_user}:{wp_pass}".encode()).decode()

        headers = {
            'Authorization': f'Basic {token}',
            'Content-Type': 'application/json',
        }

        meta = {}
        if focus_keyword:
            meta['rank_math_focus_keyword'] = focus_keyword
        if seo_description:
            meta['rank_math_description'] = seo_description

        if meta:
            response = requests.post(api_url, headers=headers, json={'meta': meta}, timeout=30)
            response.raise_for_status()
            print(f"✅ Rank Math SEO meta updated for post {post_id}")
        else:
            print("⚠️ No Rank Math SEO meta to update")

    except Exception as e:
        print(f"❌ Error setting Rank Math meta: {str(e)}")


def insert_image_after_paragraph(html_content, image_url, image_alt_text, paragraph_number=4):
    """
    Inserts an HTML image tag with class 'pinimg' after the specified paragraph.
    Uses BeautifulSoup to correctly identify and insert after the <p> tags.
    """
    if not image_url:
        return html_content

    soup = BeautifulSoup(html_content, 'html.parser')
    paragraphs = soup.find_all('p')

    # Check if there are at least N paragraphs
    if len(paragraphs) >= paragraph_number:
        target_paragraph = paragraphs[paragraph_number - 1]

        # Create the HTML for the image
        img_html = f"""
        <figure class="wp-block-image size-large pinimg">
            <img decoding="async" src="{image_url}" alt="{image_alt_text}" class="wp-image-0"/>
        </figure>
        """

        # Convert the image HTML to a BeautifulSoup element
        img_tag = BeautifulSoup(img_html, 'html.parser').find('figure')

        # Insert the image element immediately after the target paragraph
        if target_paragraph.next_sibling:
            target_paragraph.next_sibling.insert_before(img_tag)
        else:
            target_paragraph.insert_after(img_tag)

        print(f"✅ Pin image inserted after paragraph {paragraph_number}")
        return str(soup)
    else:
        print(f"⚠️ Could not insert pin image: only {len(paragraphs)} paragraphs found.")
        return html_content


# --- CORE LOGIC (Modified to accept config) ---

def create_wordpress_post(row, worksheet, row_index, config):
    """Create a WordPress post from spreadsheet row using specific config"""
    wp_url = config['WORDPRESS_URL']
    wp_user = config['WORDPRESS_password']
    wp_pass = config['WORDPRESS_PASSWORD']
    wp_domain = config['WORDPRESS_DOMAIN']

    try:
        print("\n" + "=" * 50)
        print(f"📝 Starting post creation for row {row_index} on {wp_domain}")

        # Initialize WordPress client
        wp = Client(wp_url, wp_user, wp_pass)

        # Extract row data (NOTE: Column indices are now updated based on your request)
        try:
            image_urls = row[0] if len(row) > 0 and row[0] else None  # Column A (Featured Image URLs)
            html_content = row[1] if len(row) > 1 and row[1] else ""  # Column B (Post Content)
            recipe_json = row[2] if len(row) > 2 and row[2] else None  # Column C (Recipe JSON)
            category = row[3] if len(row) > 3 and row[3] else ""  # Column D (Category)
            publish_date = row[4] if len(row) > 4 and row[4] else None  # Column E (Publish Date)
            image_slug = row[5] if len(row) > 5 and row[5] else None  # Column F (Image URL Slug)
            focus_keyword = row[6] if len(row) > 6 and row[6] else ""  # Column G (Rank Math Focus Keyword)
            seo_description = row[7] if len(row) > 7 and row[7] else ""  # Column H (Rank Math Description)
            pin_image_url = row[8] if len(row) > 8 and row[8] else None  # Column I (Pin Image URL - NEW)
            author_name = row[9] if len(row) > 9 and row[9] else None  # Column J (Author Name for Recipe)
            # Permalinks will be updated in Column K (index 10)
        except IndexError:
            print("⚠️ Row doesn't have enough columns, using default values for missing data")

        # Extract title and clean content
        title, cleaned_content = extract_and_remove_title(html_content)
        print(f"📌 Post title: {title}")

        # Use focus keyword for permalink if available
        permalink_slug = slugify(focus_keyword) if focus_keyword else slugify(title)
        print(f"🔗 Permalink slug: {permalink_slug}")

        # Upload featured image
        featured_image_id = None
        featured_image_url = None

        if image_urls:
            print("\n" + "-" * 30)
            print("🖼️ Processing featured image...")
            featured_image_id, featured_image_url = upload_image_to_wordpress(
                image_urls,
                wp,
                title,
                focus_keyword,
                image_slug,
                wp_url, wp_user, wp_pass
            )

        # Process recipe
        recipe_id = None
        if recipe_json:
            print("\n" + "-" * 30)
            print("🍳 Processing recipe data...")
            recipe_data = validate_recipe_json(recipe_json)
            if recipe_data:
                recipe_result = add_recipe_to_wordpress(recipe_data, featured_image_url, author_name, wp_url, wp_user,
                                                        wp_pass)
                if recipe_result:
                    recipe_id = recipe_result.get('id')

        # Prepare post content
        print("\n" + "-" * 30)
        print("📝 Preparing post content...")

        final_content = cleaned_content

        # INSERT PIN IMAGE HERE
        if pin_image_url:
            final_content = insert_image_after_paragraph(final_content, pin_image_url, focus_keyword)

        if recipe_id:
            final_content += f"\n[wprm-recipe id={recipe_id}]"

        # Create WordPress post
        print("\n" + "-" * 30)
        print("🚀 Creating WordPress post...")

        post = WordPressPost()
        post.title = title
        post.content = final_content
        post.post_status = 'publish' if publish_date else 'draft'
        post.slug = permalink_slug

        if featured_image_id:
            post.thumbnail = featured_image_id

        if category:
            post.terms_names = {'category': [category]}

        if publish_date:
            try:
                for fmt in (
                "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d", "%Y/%m/%d", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M"):
                    try:
                        post.date = datetime.strptime(publish_date, fmt)
                        print(f"📅 Set publish date to {post.date}")
                        break
                    except ValueError:
                        continue
                else:
                    print(f"⚠️ Couldn't parse publish date: {publish_date}")
            except Exception as e:
                print(f"⚠️ Error parsing publish date: {str(e)}")

        post_id = wp.call(NewPost(post))
        print(f"✅ Post created successfully! ID: {post_id}")

        # Get the full permalink
        full_permalink = f"{wp_domain}/{permalink_slug}/"
        print(f"🔗 Full permalink: {full_permalink}")

        # Update column K with the full permalink (column J is index 11, 1-based)
        worksheet.update_cell(row_index, 11, full_permalink)
        print(f"📝 Updated column K with full permalink: {full_permalink}")

        # Set Rank Math SEO meta
        if focus_keyword or seo_description:
            print("\n" + "-" * 30)
            print("🔍 Setting Rank Math SEO meta...")
            set_rank_math_seo_meta(post_id, focus_keyword, seo_description, wp_url, wp_user, wp_pass)

        return post_id

    except Exception as e:
        print(f"❌ Error creating post: {str(e)}")
        return None


def process_sheet(domain, config):
    """Handles the main logic for a single sheet/domain configuration."""
    try:
        print("\n" + "#" * 60)
        print(f"### 🌐 STARTING PROCESSING FOR DOMAIN: {domain} ###")
        print("#" * 60)

        worksheet = connect_to_google_sheets(config['SHEET_NAME'])
        rows = worksheet.get_all_values()

        if not rows or len(rows) < 2:
            print(f"ℹ️ No data found in the worksheet for {domain}")
            return

        print(f"📊 Found {len(rows) - 1} rows to process on sheet: {config['SHEET_NAME']}")

        start_index = max(1, START_ROW)
        print(f"⏩ Starting from row {start_index}")

        for i, row in enumerate(rows[start_index:], start=start_index + 1):
            # Check for content in key columns (A: Image URLs, B: Content, C: Recipe JSON)
            if not any(cell.strip() for cell in row[:3]):
                print(f"⏩ Skipping empty row {i}")
                continue

            print("\n" + "=" * 50)
            print(f"📋 Processing row {i}...")
            post_id = create_wordpress_post(row, worksheet, i, config)

            if post_id:
                print(f"✅ Successfully created post {post_id} from row {i}")
                time.sleep(2)
            else:
                print(f"❌ Failed to create post from row {i}")

        print("\n" + "#" * 60)
        print(f"### ✅ FINISHED PROCESSING FOR DOMAIN: {domain} ###")
        print("#" * 60)

    except Exception as e:
        print(f"❌ Fatal error while processing {domain}: {str(e)}")


def main():
    """Main function to iterate over all configurations."""
    try:
        print("🚀 Starting multi-domain script...")

        for domain, config in CONFIGS.items():
            process_sheet(domain, config)

        print("\n" + "*" * 60)
        print("🎉 Script completed for ALL configured domains!")
        print("*" * 60)

    except Exception as e:
        print(f"❌ Global Fatal error: {str(e)}")


if __name__ == '__main__':
    main()