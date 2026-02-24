from __future__ import annotations
import json
import re
import time
from typing import Callable
from openai import OpenAI


def _get_client(api_key: str) -> OpenAI:
    return OpenAI(api_key=api_key)


def generate_with_openai(prompt: str, api_key: str, max_retries: int = 3, log: Callable[[str], None] | None = None) -> str:
    _log = log or print
    client = _get_client(api_key)
    for attempt in range(max_retries):
        try:
            _log(f"OpenAI attempt {attempt + 1}/{max_retries}")
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7,
                max_tokens=4000,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            error_msg = str(e)
            _log(f"OpenAI error: {error_msg}")
            if "rate limit" in error_msg.lower():
                wait = 30 * (2 ** attempt)
                _log(f"Rate limited. Waiting {wait}s...")
                time.sleep(wait)
            elif attempt < max_retries - 1:
                wait = 10 * (attempt + 1)
                _log(f"Retrying in {wait}s...")
                time.sleep(wait)
            else:
                return f"Error: {error_msg}"
    return f"Error: Failed after {max_retries} attempts"


def generate_article(recipe_title: str, full_recipe: str, external_links: str, internal_links: list[str], api_key: str, log: Callable[[str], None] | None = None) -> str:
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
    result = generate_with_openai(prompt, api_key, log=log)
    result = re.sub(r'```html\s*', '', result)
    result = re.sub(r'\s*```', '', result)
    return result


def generate_full_recipe(recipe_title: str, api_key: str, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    prompt = (
        f"COPY-PASTE READY Long And Easy To Read Food Recipe : {recipe_title} "
        f"no additional text with title and Ingredients, write recipe "
        f"(ingredients, instructions, nutrition) based on ingredients"
    )
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a professional recipe writer."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.7,
        max_tokens=2000,
    )
    result = response.choices[0].message.content.strip()
    return re.sub(r'[*#]+', '', result)


def generate_recipe_json(recipe_title: str, full_recipe: str, author: str, api_key: str, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    prompt = f"""
       Generate a complete recipe for "{full_recipe}" that can be directly imported into WP Recipe Maker plugin.

        Structure the response as a valid JSON object with these required fields:
        {{
            "type": "wprm_recipe",
            "name": "The full recipe title",
            "summary": "A brief 1-2 sentence description of the recipe",
            "author": {{"id": 1, "name": ""}},
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
            "equipment": [{{"name": "Mixing Bowl"}}, {{"name": "Baking Sheet"}}],
            "ingredients_flat": [
                {{"uid": "group_1", "name": "Main Ingredients", "type": "group"}},
                {{"uid": "ingredient_1", "name": "Ingredient Name", "amount": "1", "unit": "cup", "notes": "", "group": "group_1", "type": "ingredient"}}
            ],
            "instructions_flat": [
                {{"uid": "group_1", "name": "Instructions", "type": "group"}},
                {{"uid": "instruction_1", "text": "Step description text", "group": "group_1", "type": "instruction"}}
            ],
            "nutrition": {{"calories": "350 kcal", "carbohydrates": "45 g", "protein": "10 g", "fat": "15 g"}},
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
            {"role": "system", "content": "You are a professional recipe creator that outputs perfect JSON for WP Recipe Maker with ALL required fields."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.7,
        max_tokens=3000,
    )

    model_response = response.choices[0].message.content
    clean_json = re.sub(r'```(?:json)?(.*?)```', r'\1', model_response, flags=re.DOTALL).strip()

    base_template = _get_wp_recipe_template(recipe_title, f"Delicious {recipe_title} recipe.")
    base_template["author"]["name"] = author if author else "Recipe Author"

    try:
        recipe_data = json.loads(clean_json)
        for field in recipe_data:
            if field in base_template:
                if isinstance(base_template[field], dict) and isinstance(recipe_data[field], dict):
                    base_template[field].update(recipe_data[field])
                else:
                    base_template[field] = recipe_data[field]
        for nf in ["calories", "carbohydrates", "protein", "fat", "saturated_fat",
                    "cholesterol", "sodium", "potassium", "fiber", "sugar",
                    "vitamin_a", "vitamin_c", "calcium", "iron"]:
            if nf not in base_template["nutrition"]:
                base_template["nutrition"][nf] = ""
    except json.JSONDecodeError:
        pass

    return json.dumps(base_template, indent=2)


def generate_meta_description(recipe_title: str, api_key: str, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are an SEO expert."},
            {"role": "user", "content": f"Generate a meta description of 155 characters for the recipe with the Main Keyword '{recipe_title}'"},
        ],
        temperature=0.7,
        max_tokens=100,
    )
    result = response.choices[0].message.content.strip()
    return re.sub(r'[*#"]', '', result)


def generate_category(recipe_title: str, api_key: str, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a food classification expert."},
            {"role": "user", "content": f"Based solely on the recipe name '{recipe_title}', which category does it best fit into? Only respond with one of these exact words: Breakfast, Dinner, Salad, or Dessert. No other text or explanation."},
        ],
        temperature=0.3,
        max_tokens=20,
    )
    return response.choices[0].message.content.strip()


def generate_pinterest_pin_title(recipe_title: str, api_key: str, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a Pinterest marketing expert."},
            {"role": "user", "content": f"Create a clear and engaging Pinterest Pin title for '{recipe_title}'. Keep it under 100 characters, include common Pinterest search keywords, and make it appeal to users looking for new recipe ideas"},
        ],
        temperature=0.7,
        max_tokens=100,
    )
    return re.sub(r'[*#"]', '', response.choices[0].message.content.strip())


def generate_pinterest_pin_description(recipe_title: str, api_key: str, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a Pinterest content specialist."},
            {"role": "user", "content": f"Using the following title and keywords '{recipe_title}', create a Pinterest-friendly description that is clear, keyword-rich, and written in an engaging, natural tone. Avoid hype or sales-driven phrases. Compose 2-3 sentences that blend the keywords smoothly, evoke seasonal or emotional appeal, and close with a subtle CTA like 'Learn more' or 'Explore the recipe'"},
        ],
        temperature=0.7,
        max_tokens=200,
    )
    return re.sub(r'[*#"]', '', response.choices[0].message.content.strip())


def generate_pinterest_pin_tags(recipe_title: str, api_key: str, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are a Pinterest SEO expert."},
            {"role": "user", "content": f"Generate Pinterest pin relevant tags for '{recipe_title}' as a comma-separated list. Include 10-15 relevant tags that are commonly searched on Pinterest for recipes"},
        ],
        temperature=0.7,
        max_tokens=150,
    )
    return re.sub(r'[*#"]', '', response.choices[0].message.content.strip())


def _get_wp_recipe_template(title: str, summary: str) -> dict:
    return {
        "type": "wprm_recipe",
        "name": title,
        "summary": summary,
        "author": {"id": 1, "name": ""},
        "servings": 4,
        "servings_unit": "servings",
        "cost": "",
        "prep_time": 15,
        "cook_time": 30,
        "total_time": 45,
        "custom_time": 0,
        "custom_time_label": "",
        "rating": {"count": 0, "total": 0, "average": 0},
        "tags": {"course": [], "cuisine": [], "keyword": [], "difficulty": "easy"},
        "equipment": [],
        "ingredients_flat": [{"uid": "group_1", "name": "Main Ingredients", "type": "group"}],
        "instructions_flat": [{"uid": "group_1", "name": "Instructions", "type": "group"}],
        "nutrition": {
            "calories": "", "carbohydrates": "", "protein": "", "fat": "",
            "saturated_fat": "", "cholesterol": "", "sodium": "", "potassium": "",
            "fiber": "", "sugar": "", "vitamin_a": "", "vitamin_c": "",
            "calcium": "", "iron": "",
        },
        "custom_fields": {},
        "notes": "",
    }
