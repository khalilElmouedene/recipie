import requests
import os
import time
import re
import unicodedata
import json
import xml.etree.ElementTree as ET
from urllib.parse import urljoin
from datetime import datetime, timedelta
import random
from Google import Create_Service
from dotenv import load_dotenv
from openai import OpenAI
import sys
import time

START_ROW = int(sys.argv[1]) if len(sys.argv) > 1 else 1
WAIT_TIME = int(sys.argv[2]) if len(sys.argv) > 2 else 190

load_dotenv()

# Initialize OpenAI client
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY environment variable is required")
client = OpenAI(api_key=OPENAI_API_KEY)

# Sheet configuration
sheet_names = {
    "1": "lorachef.com",
    "2": "oviarecipes.com",
    "3": "chefboiardi.com",
    "4": "chefandpress.com"
}

# Google Sheets setup
CLIENT_SECRET_FILE = os.path.join('Client_Secret.json')
API_SERVICE_NAME = 'sheets'
API_VERSION = 'v4'
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

service = Create_Service(CLIENT_SECRET_FILE, API_SERVICE_NAME, API_VERSION, SCOPES)
spreadsheetID = "15shOy7333VvZlS87jZqmxRg0-LB9AiTmzngRWnOsdRc"


class RecipePost:
    def __init__(self, featured_image, articles, recipe_json, category, publish_date,
                 focus_keyword, meta_description, full_recipe, link_article, author, external, internal):
        self.featured_image = featured_image
        self.articles = articles
        self.recipe_json = recipe_json
        self.category = category
        self.publish_date = publish_date
        self.focus_keyword = focus_keyword
        self.meta_description = meta_description
        self.full_recipe = full_recipe
        self.link_article = link_article
        self.author = author
        self.external = external
        self.internal = internal

    def __repr__(self):
        return (f"RecipePost(featured_image={self.featured_image}, author={self.author}, "
                f"articles={self.articles[:30] if self.articles else ''}...)")


class MidjourneyApi:
    def __init__(self, prompt, application_id, guild_id, channel_id, version, id, authorization):
        self.application_id = application_id
        self.guild_id = guild_id
        self.channel_id = channel_id
        self.version = version
        self.id = id
        self.authorization = authorization
        self.prompt = prompt
        self.message_id = ""
        self.custom_ids = ""
        self.image_path_str = ""

    def send_message(self):
        url = "https://discord.com/api/v9/interactions"
        data = {
            "type": 2,
            "application_id": self.application_id,
            "guild_id": self.guild_id,
            "channel_id": self.channel_id,
            "session_id": "cannot be empty",
            "data": {
                "version": self.version,
                "id": self.id,
                "name": "imagine",
                "type": 1,
                "options": [{"type": 3, "name": "prompt", "value": self.prompt}],
                "application_command": {
                    "id": self.id,
                    "application_id": self.application_id,
                    "version": self.version,
                    "default_member_permissions": None,
                    "type": 1,
                    "nsfw": False,
                    "name": "imagine",
                    "description": "Create images with Midjourney",
                    "dm_permission": True,
                    "contexts": None,
                    "options": [{
                        "type": 3,
                        "name": "prompt",
                        "description": "The prompt to imagine",
                        "required": True
                    }]
                },
                "attachments": []
            },
        }
        headers = {
            'Authorization': self.authorization,
            'Content-Type': 'application/json',
        }
        response = requests.post(url, headers=headers, json=data)
        return response

    def get_message(self):
        headers = {
            'Authorization': self.authorization,
            "Content-Type": "application/json",
        }
        time.sleep(WAIT_TIME)  # hna Wait for image generation
        try:
            response = requests.get(f'https://discord.com/api/v9/channels/{self.channel_id}/messages', headers=headers)
            messages = response.json()
            most_recent_message_id = messages[0]['id']
            self.message_id = most_recent_message_id
            components = messages[0]['components'][0]['components']
            buttons = [comp for comp in components if comp.get('label') in ['U1', 'U2', 'U3', 'U4']]
            self.custom_ids = [button['custom_id'] for button in buttons]
        except Exception as e:
            print(f"Error getting messages: {e}")
            raise ValueError("Timeout")

    def choose_images(self):
        url = "https://discord.com/api/v9/interactions"
        headers = {
            "Authorization": self.authorization,
            "Content-Type": "application/json",
        }
        self.get_message()
        if not self.custom_ids:
            raise ValueError("No buttons found to upscale images")
        for custom_id in self.custom_ids[:4]:
            data = {
                "type": 3,
                "guild_id": self.guild_id,
                "channel_id": self.channel_id,
                "message_flags": 0,
                "message_id": self.message_id,
                "application_id": self.application_id,
                "session_id": "cannot be empty",
                "data": {"component_type": 2, "custom_id": custom_id}
            }
            response = requests.post(url, headers=headers, json=data)
            if response.status_code != 204:
                print(f"Failed to upscale image with button {custom_id}, status code: {response.status_code}")
            time.sleep(10)

    def download_image(self):
        headers = {
            'Authorization': self.authorization,
            "Content-Type": "application/json",
        }
        img = []
        try:
            response = requests.get(f'https://discord.com/api/v9/channels/{self.channel_id}/messages', headers=headers)
            messages = response.json()
            i = 0
            while (i < 4):
                most_recent_message_id = messages[i]['id']
                self.message_id = most_recent_message_id
                image_url = messages[i]['attachments'][0]['url']
                image_response = requests.get(image_url)
                img.append(image_url)
                i = i + 1
            return img
        except Exception as e:
            print(f"Error downloading images: {e}")
            raise ValueError("Timeout")


def update_spreadsheet(sheet_name, row, column, value):
    """Update a specific cell in the spreadsheet"""
    spreadsheet_data = {
        "range": f"{sheet_name}!{chr(65 + column)}{row + 1}",
        "values": [[value]]
    }
    update_data = {
        "valueInputOption": "RAW",
        "data": [spreadsheet_data]
    }
    request = service.spreadsheets().values().batchUpdate(
        spreadsheetId=spreadsheetID, body=update_data
    )
    response = request.execute()
    print(f"Updated {sheet_name} - column {chr(65 + column)} row {row + 1}")


def generate_with_openai(prompt, max_retries=3):
    """Generate text with OpenAI GPT-4o-mini with exponential backoff for rate limiting"""
    for attempt in range(max_retries):
        try:
            print(f"Attempt {attempt + 1}/{max_retries} using model: gpt-4o-mini")
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,
                max_tokens=4000
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            error_msg = str(e)
            print(f"Error: {error_msg}")
            if "rate limit" in error_msg.lower():
                wait_time = 30 * (2 ** attempt)
                print(f"Rate limited. Waiting {wait_time} seconds before retry...")
                time.sleep(wait_time)
                continue
            elif "api" in error_msg.lower():
                if attempt < max_retries - 1:
                    wait_time = 10 * (attempt + 1)
                    print(f"API error. Waiting {wait_time} seconds before retry...")
                    time.sleep(wait_time)
                    continue
                else:
                    return f"Error: OpenAI API error after {max_retries} attempts"
            else:
                if attempt < max_retries - 1:
                    wait_time = 5 * (attempt + 1)
                    print(f"Unexpected error. Waiting {wait_time} seconds before retry...")
                    time.sleep(wait_time)
                    continue
                else:
                    return f"Error: {error_msg}"
    return f"Error: Failed after {max_retries} attempts"


def generate_random_past_date():
    """Generate a random date within the last 6 months with random time"""
    end_date = datetime.now()
    start_date = end_date - timedelta(days=180)

    random_days = random.randint(0, 180)
    random_hours = random.randint(0, 23)
    random_minutes = random.randint(0, 59)

    random_date = start_date + timedelta(days=random_days, hours=random_hours, minutes=random_minutes)
    return random_date.strftime("%Y/%m/%d %H:%M")


def get_wp_recipe_maker_template(title, summary):
    return {
        "type": "wprm_recipe",
        "name": title,
        "summary": summary,
        "author": {
            "id": 1,
            "name": ""
        },
        "servings": 4,
        "servings_unit": "servings",
        "cost": "",
        "prep_time": 15,
        "cook_time": 30,
        "total_time": 45,
        "custom_time": 0,
        "custom_time_label": "",
        "rating": {
            "count": 0,
            "total": 0,
            "average": 0
        },
        "tags": {
            "course": [],
            "cuisine": [],
            "keyword": [],
            "difficulty": "easy"
        },
        "equipment": [],
        "ingredients_flat": [
            {
                "uid": "group_1",
                "name": "Main Ingredients",
                "type": "group"
            }
        ],
        "instructions_flat": [
            {
                "uid": "group_1",
                "name": "Instructions",
                "type": "group"
            }
        ],
        "nutrition": {
            "calories": "",
            "carbohydrates": "",
            "protein": "",
            "fat": "",
            "saturated_fat": "",
            "cholesterol": "",
            "sodium": "",
            "potassium": "",
            "fiber": "",
            "sugar": "",
            "vitamin_a": "",
            "vitamin_c": "",
            "calcium": "",
            "iron": ""
        },
        "custom_fields": {},
        "notes": ""
    }


def generate_article(recipe_title, full_recipe, external_links, internal_links):
    prompt = (
        f"Generate a complete, fully written recipe article for '{recipe_title}' based on the recipe details: {full_recipe}. "
        f"The article must be at least 1300 words and include:\n\n"
        f"1. COMPLETE ARTICLE STRUCTURE:\n"
        f"- Engaging introduction (200-300 words)\n"
        f"- Why you'll love this recipe section (300-400 words)\n"
        f"- Why you should try this recipe section (300-400 words)\n"
        f"- Ingredients and necessary utensils with detailed list and quantities (300-500 words)\n"
        f"- Detailed recipe steps with practical tips (300-400 words)\n"
        f"- FAQ section with 4-6 relevant questions and answers\n"
        f"- Conclusion (100-200 words)\n\n"
        f"2. SEO OPTIMIZATION:\n"
        f"- Use focus keyword '{recipe_title}' naturally throughout\n"
        f"- Include H2, H3, H4 headings with keywords\n"
        f"- Add 1 external link to Pinterest\n"
        f"- Add 5-7 internal links naturally distributed\n"
        f"- Write meta description (will be used separately)\n\n"
        f"3. FORMATTING:\n"
        f"- Output as clean HTML without <head>, <body> tags\n"
        f"- Start directly with H1 for the title\n"
        f"- Use proper HTML tags for lists, headings, paragraphs\n"
        f"- Make it mobile-friendly and readable\n\n"
        f"4. CONTENT QUALITY:\n"
        f"- Unique, well-structured content\n"
        f"- Perfect grammar and spelling\n"
        f"- Natural and engaging tone\n"
        f"- No content duplication\n\n"
        f"Write the complete article now with all sections fully developed."
    )

    return generate_with_openai(prompt)


def generate_recipe_json(recipe_title, full_recipe, author):
    prompt = f"""
       Generate a complete recipe for "{full_recipe}" that can be directly imported into WP Recipe Maker plugin.

        Structure the response as a valid JSON object with these required fields:
        {{
            "type": "wprm_recipe",
            "name": "The full recipe title",
            "summary": "A brief 1-2 sentence description of the recipe",
            "author": {{
                "id": 1,
                "name": ""
            }},
            "servings": 4,
            "servings_unit": "servings",
            "prep_time": 15,
            "cook_time": 30,
            "total_time": 45,
            "tags": {{
                "course": ["Main Course"],
                "cuisine": ["American"],
                "keyword": ["easy", "quick", "delicious"]
            }},
            "equipment": [
                {{
                    "name": "Mixing Bowl"
                }},
                {{
                    "name": "Baking Sheet"
                }}
            ],
            "ingredients_flat": [
                {{
                    "uid": "group_1",
                    "name": "Main Ingredients",
                    "type": "group"
                }},
                {{
                    "uid": "ingredient_1",
                    "name": "Ingredient Name",
                    "amount": "1",
                    "unit": "cup",
                    "notes": "",
                    "group": "group_1",
                    "type": "ingredient"
                }}
            ],
            "instructions_flat": [
                {{
                    "uid": "group_1",
                    "name": "Instructions",
                    "type": "group"
                }},
                {{
                    "uid": "instruction_1",
                    "text": "Step description text",
                    "group": "group_1",
                    "type": "instruction"
                }}
            ],
            "nutrition": {{
                "calories": "350 kcal",
                "carbohydrates": "45 g",
                "protein": "10 g",
                "fat": "15 g"
            }},
            "notes": "Any additional tips or variations for the recipe"
        }}

        Create a detailed, realistic recipe easy to rank google seo with:
        - At least 6-10 ingredients with proper amounts and units
        - At least 5-8 detailed instruction steps
        - Reasonable prep and cook times
        - Appropriate nutrition information
        - Relevant tags for course, cuisine, and keywords

        Return ONLY the valid JSON, with no additional commentary or formatting.
    """

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system",
             "content": "You are a professional recipe creator that outputs perfect JSON for WP Recipe Maker with ALL required fields."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.7,
        max_tokens=3000
    )

    model_response = response.choices[0].message.content
    clean_json = re.sub(r'```(?:json)?(.*?)```', r'\1', model_response, flags=re.DOTALL)
    clean_json = clean_json.strip()

    try:
        recipe_data = json.loads(clean_json)
        base_template = get_wp_recipe_maker_template(recipe_title, f"Delicious {recipe_title} recipe.")
        base_template["author"]["name"] = author if author else "Recipe Author"

        for field in recipe_data:
            if field in base_template:
                if isinstance(base_template[field], dict) and isinstance(recipe_data[field], dict):
                    base_template[field].update(recipe_data[field])
                else:
                    base_template[field] = recipe_data[field]

        nutrition_fields = ["calories", "carbohydrates", "protein", "fat", "saturated_fat",
                            "cholesterol", "sodium", "potassium", "fiber", "sugar",
                            "vitamin_a", "vitamin_c", "calcium", "iron"]

        for field in nutrition_fields:
            if field not in base_template["nutrition"]:
                base_template["nutrition"][field] = ""

        json_recipe = json.dumps(base_template, indent=2)

    except json.JSONDecodeError as e:
        print(f"JSON decode error: {e}")
        template = get_wp_recipe_maker_template(recipe_title, f"Delicious {recipe_title} recipe.")
        template["author"]["name"] = author if author else "Recipe Author"
        json_recipe = json.dumps(template, indent=2)

    return json_recipe


def get_sitemap_links(sitemap_url):
    try:
        if not sitemap_url.startswith(('http://', 'https://')):
            sitemap_url = 'https://' + sitemap_url

        response = requests.get(sitemap_url)
        response.raise_for_status()

        root = ET.fromstring(response.content)
        namespace = {'sitemap': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
        urls = []
        for url_element in root.findall('.//sitemap:url', namespace):
            loc_element = url_element.find('sitemap:loc', namespace)
            if loc_element is not None:
                urls.append(loc_element.text)
        return urls
    except Exception as e:
        print(f"Error processing sitemap: {e}")
        return []


def clean_keyword(text):
    if not text:
        return ""

    zero_width_chars = [
        '\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad'
    ]

    cleaned_text = text
    for char in zero_width_chars:
        cleaned_text = cleaned_text.replace(char, '')

    cleaned_text = unicodedata.normalize('NFKC', cleaned_text)
    cleaned_text = re.sub(r'&[a-zA-Z0-9#]+;', '', cleaned_text)
    cleaned_text = ''.join(char for char in cleaned_text if char.isprintable() or char in ' \t\n')
    cleaned_text = re.sub(r'\s+', ' ', cleaned_text)
    cleaned_text = cleaned_text.strip()
    cleaned_text = ''.join(char for char in cleaned_text if ord(char) >= 32 or char in '\t\n')

    return cleaned_text


def get_recipe_data_from_sheet(sheet_name):
    """Get recipe data from specified sheet"""
    sheet = service.spreadsheets()
    result = sheet.values().get(spreadsheetId=spreadsheetID, range=f"{sheet_name}!A:Z").execute()
    values = result.get('values', [])

    imgList = []
    recipeList = []
    if not values:
        print(f'No data found in {sheet_name}.')
    else:
        for row in values:
            if len(row) >= 2:
                imgList.append(row[0])
                recipeList.append(row[1])
            else:
                print(f"Skipping incomplete row in {sheet_name}: {row}")

    return imgList, recipeList


def get_sheet_data_for_row(sheet_name, row_index):
    """Get specific row data from sheet"""
    sheet = service.spreadsheets()
    result = sheet.values().get(spreadsheetId=spreadsheetID, range=f"{sheet_name}!A:Z").execute()
    values = result.get('values', [])

    if not values or row_index >= len(values):
        return None

    row = values[row_index]
    return row


def process_row_by_row():
    """Process sheets row by row - images then content for each row"""
    print("=== ROW-BY-ROW PROCESSING ===")

    # Get data from lorachef.com sheet to determine number of rows
    imgList, recipeList = get_recipe_data_from_sheet("lorachef.com")

    if not imgList or not recipeList:
        print("No data found for processing")
        return

    total_rows = len(imgList)

    # hna Start from row 1 (skip header row 0)
    for row_index in range(1, total_rows):
        print(f"\n{'=' * 50}")
        print(f"PROCESSING ROW {row_index}")
        print(f"{'=' * 50}")

        # PHASE 1: Generate images for current row across all sheets
        print(f"\n--- PHASE 1: IMAGE GENERATION FOR ROW {row_index} ---")

        sourceImg = imgList[row_index]
        recipe_name = recipeList[row_index].splitlines()[0] if recipeList[row_index] else f"Recipe {row_index}"

        print(f"Source image: {sourceImg}")
        print(f"Recipe: {recipe_name}")

        # Generate images
        while True:
            try:
                im = MidjourneyApi(
                    "/imagine prompt:  " + recipe_name + " | Amateur photo, taken with an iPhone 15 Pro  |  --ar 5:6 --v 7   --sref " + sourceImg + " ",
                    os.getenv("DISCORD_APPLICATION_ID", "936929561302675456"),
                    os.getenv("DISCORD_GUILD_ID", "1288141309021782168"),
                    os.getenv("DISCORD_CHANNEL_ID", "1288141309542142018"),
                    os.getenv("MIDJOURNEY_VERSION", "1237876415471554623"),
                    os.getenv("MIDJOURNEY_ID", "938956540159881230"),
                    os.getenv("DISCORD_AUTHORIZATION", "")
                )
                break
            except Exception as e:
                print("Regenerate...", e)

        im.send_message()
        im.get_message()
        im.choose_images()
        img_urls = im.download_image()

        # Distribute images to different sheets for current row
        update_spreadsheet("lorachef.com", row_index, 0, img_urls[0])
        update_spreadsheet("oviarecipes.com", row_index, 0, img_urls[1])
        update_spreadsheet("chefboiardi.com", row_index, 0, img_urls[2])
        update_spreadsheet("chefandpress.com", row_index, 0, img_urls[3])

        print(f"✓ Completed image generation for row {row_index}")

        # PHASE 2: Generate content for current row across all sheets
        print(f"\n--- PHASE 2: CONTENT GENERATION FOR ROW {row_index} ---")

        for sheet_num, sheet_name in sheet_names.items():
            print(f"\n--- Processing content for {sheet_name} row {row_index} ---")

            # Get the specific row data for this sheet
            row_data = get_sheet_data_for_row(sheet_name, row_index)

            if not row_data:
                print(f"No data found for {sheet_name} row {row_index}")
                continue

            try:
                # Extract data from the row
                featured_image = row_data[0] if len(row_data) > 0 else ""
                articles = row_data[1] if len(row_data) > 1 else ""
                recipe_json = row_data[2] if len(row_data) > 2 else ""
                category = row_data[3] if len(row_data) > 3 else ""
                publish_date = row_data[4] if len(row_data) > 4 else ""
                focus_keyword = row_data[5] if len(row_data) > 5 else ""
                meta_description = row_data[6] if len(row_data) > 6 else ""
                full_recipe = row_data[7] if len(row_data) > 7 else ""
                link_article = row_data[8] if len(row_data) > 8 else ""
                author = row_data[9] if len(row_data) > 9 else ""
                internal = row_data[12] if len(row_data) > 12 else ""
                external = row_data[13] if len(row_data) > 13 else ""

                recipe_title = articles.splitlines()[0] if articles and len(
                    articles.splitlines()) > 0 else f"Recipe {row_index}"

                print(f"Processing: {recipe_title}")

                # Generate random publish date
                print(f"Generating random publish date...")
                publish_date = generate_random_past_date()
                update_spreadsheet(sheet_name, row_index, 4, publish_date)

                # Generate full recipe
                print(f"Creating full recipe...")
                prompt = f'COPY-PASTE READY Long And Easy To Read Food Recipe : {recipe_title} no additional text with title and Ingredients , write recipe (ingredients, instructions, nutrition) based on ingredients'

                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "You are a professional recipe writer."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.7,
                    max_tokens=2000
                )

                full_recipe = response.choices[0].message.content.strip()
                # Clean the recipe text but keep it readable
                full_recipe = re.sub(r'[*#]+', '', full_recipe)
                update_spreadsheet(sheet_name, row_index, 7, full_recipe)

                # Add Focus Keyword
                print(f"Adding focus keyword...")
                focus_keyword = clean_keyword(recipe_title)
                focus_keyword = re.sub(r'[*#"]', '', focus_keyword)
                update_spreadsheet(sheet_name, row_index, 5, focus_keyword)

                # Generate JSON WP Recipe Maker Recipe
                print(f"Generating JSON recipe...")
                json_recipe = generate_recipe_json(recipe_title, full_recipe, author)
                update_spreadsheet(sheet_name, row_index, 2, json_recipe)

                # Generate WP article
                print(f"Creating WP article...")
                print("Fetching links from sitemap...")
                current_sheet_internal = get_sitemap_links(sheet_name + "/post-sitemap1.xml")
                newArticle = generate_article(recipe_title, full_recipe, external, current_sheet_internal)
                # Clean the article text but preserve HTML structure
                newArticle = re.sub(r'```html\s*', '', newArticle)
                newArticle = re.sub(r'\s*```', '', newArticle)
                update_spreadsheet(sheet_name, row_index, 1, newArticle)

                # Generate meta description
                print(f"Creating meta description...")
                prompt = f"Generate a meta description of 155 characters for the recipe with the Main Keyword '{recipe_title}'"

                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "You are an SEO expert."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.7,
                    max_tokens=100
                )

                meta_description = response.choices[0].message.content.strip()
                meta_description = re.sub(r'[*#"]', '', meta_description)
                update_spreadsheet(sheet_name, row_index, 6, meta_description)

                # Generate Pinterest Pin Title (Column I)
                print(f"Creating Pinterest pin title...")
                pin_title_prompt = f"Create a clear and engaging Pinterest Pin title for '{recipe_title}'. Keep it under 100 characters, include common Pinterest search keywords, and make it appeal to users looking for new recipe ideas"

                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "You are a Pinterest marketing expert."},
                        {"role": "user", "content": pin_title_prompt}
                    ],
                    temperature=0.7,
                    max_tokens=100
                )

                pin_title = response.choices[0].message.content.strip()
                pin_title = re.sub(r'[*#"]', '', pin_title)
                update_spreadsheet(sheet_name, row_index, 8, pin_title)  # Column I (index 8)

                # Generate Pinterest Pin Description (Column K)
                print(f"Creating Pinterest pin description...")
                pin_desc_prompt = f"Using the following title and keywords '{recipe_title}', create a Pinterest-friendly description that is clear, keyword-rich, and written in an engaging, natural tone. Avoid hype or sales-driven phrases. Compose 2–3 sentences that blend the keywords smoothly, evoke seasonal or emotional appeal, and close with a subtle CTA like 'Learn more' or 'Explore the recipe'"

                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "You are a Pinterest content specialist."},
                        {"role": "user", "content": pin_desc_prompt}
                    ],
                    temperature=0.7,
                    max_tokens=200
                )

                pin_description = response.choices[0].message.content.strip()
                pin_description = re.sub(r'[*#"]', '', pin_description)
                update_spreadsheet(sheet_name, row_index, 10, pin_description)  # Column K (index 10)

                # Generate Pinterest Pin Tags (Column L)
                print(f"Creating Pinterest pin tags...")
                pin_tags_prompt = f"Generate Pinterest pin relevant tags for '{recipe_title}' as a comma-separated list. Include 10-15 relevant tags that are commonly searched on Pinterest for recipes"

                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "You are a Pinterest SEO expert."},
                        {"role": "user", "content": pin_tags_prompt}
                    ],
                    temperature=0.7,
                    max_tokens=150
                )

                pin_tags = response.choices[0].message.content.strip()
                pin_tags = re.sub(r'[*#"]', '', pin_tags)
                update_spreadsheet(sheet_name, row_index, 11, pin_tags)  # Column L (index 11)

                # Generate category
                print(f"Creating category...")
                prompt = f"Based solely on the recipe name '{recipe_title}', which category does it best fit into? Only respond with one of these exact words: Breakfast, Dinner, Salad, or Dessert. No other text or explanation."

                response = client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "You are a food classification expert."},
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.3,
                    max_tokens=20
                )

                category = response.choices[0].message.content.strip()
                update_spreadsheet(sheet_name, row_index, 3, category)

                print(f"✓ Completed content for {sheet_name} row {row_index}")

                # Add delay between content processing for different sheets
                time.sleep(5)

            except Exception as e:
                print(f"Error processing {sheet_name} row {row_index}: {str(e)}")
                continue

        print(f"\n✓ COMPLETED ROW {row_index} OF {total_rows - 1}")

        # Add delay between rows
        if row_index < total_rows - 1:
            print("Waiting before processing next row...")
            time.sleep(30)


def main():
    """Main execution function"""
    print("=== RECIPE CONTENT GENERATION SCRIPT ===")
    print("PROCESSING METHOD: Row by Row")
    print("For each row: Generate images for all sheets → Generate content for all sheets")

    # Process row by row
    process_row_by_row()

    print("\n=== ALL PROCESSING COMPLETED ===")


if __name__ == "__main__":
    main()