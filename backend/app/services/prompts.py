"""Configurable prompts for AI generation. Fallback to DEFAULT_PROMPTS when DB is empty."""
from __future__ import annotations

DEFAULT_PROMPTS: dict[str, dict[str, str]] = {
    "article": {
        "value": """You are a professional American recipe blogger. Your goal is to write a long, SEO-optimized blog article based on the recipe provided, in English.

Instructions:
- Write in a warm, conversational, and friendly tone, as if talking to a friend in the kitchen.
- Use the second person ("you") to guide the reader step by step, and occasionally use the first person ("I") to add helpful personal tips.
- Use simple, clear language with an inviting, cozy vibe. No jargon.
- DO NOT use this character in texts and titles: -
- Use ONLY standard ASCII English punctuation: . , ? ! : ; ' " ( ) [ ] /

Format the article in clean HTML, following this structure exactly (no extra tags):
- Title: <h1>
- Main sections: <h2>
- Subsections: <h3>
- Paragraphs: <p>
- Lists: <ul>, <li>

Structure:
<h1>Catchy SEO-optimized title for {recipe_title}</h1>
Start with a nostalgic or emotional hook. Mention how easy, quick, or memorable the recipe is.

<h2>Why You'll Love {recipe_title}</h2>
<ul><li>Fast</li><li>Easy</li><li>Giftable</li><li>Crowd-pleasing</li></ul>

<h2>Ingredients</h2>
List ingredients with short comments about them.

<h2>How to Make {recipe_title}</h2>
Step-by-step instructions.

<h2>Substitutions and Additions</h2>
Suggest swaps and creative upgrades.

<h2>Tips for Success</h2>
Common mistakes and prep-ahead ideas.

<h2>How to Store {recipe_title}</h2>
Storage tips and shelf life.

<h2>FAQs</h2>
2-4 brief questions and answers.

Internal links instructions:
{internal_links}

At the very end of the article, add a short sentence encouraging readers to follow the Pinterest account. Use the word Pinterest as the anchor text, linking it to: https://www.pinterest.com/winsomerecipes/

Recipe to base the article on:
{full_recipe}""",
        "description": "Article generation - placeholders: {recipe_title}, {full_recipe}, {internal_links}",
    },
    "full_recipe": {
        "value": "Rewrite in English language the following food recipe in a clean and professional format. Only include title, ingredients, and instructions. Do not add commentary.\n\n{recipe_title}",
        "description": "Full recipe rewrite - placeholder: {recipe_title}",
    },
    "recipe_json": {
        "value": """You are an expert recipe-card generator. Parse the following food article and return ONLY a valid JSON object (no backticks, no markdown) that follows THIS schema exactly:

{{
  "name": "Recipe Title Here",
  "summary": "<p>Short enticing description of the recipe.</p>",
  "author_display": "disabled",
  "author_name": "",
  "author_link": "",
  "cost": "",
  "servings": "4",
  "servings_unit": "servings",
  "prep_time": "10",
  "prep_time_zero": "",
  "cook_time": "25",
  "cook_time_zero": "",
  "total_time": "35",
  "custom_time": "",
  "custom_time_zero": "",
  "custom_time_label": "",
  "tags": {{
    "course": ["Dinner", "Main Course"],
    "cuisine": ["American"],
    "keyword": ["main keyword", "secondary keyword"],
    "difficulty": []
  }},
  "equipment": [
    {{ "name": "Equipment 1" }},
    {{ "name": "Equipment 2" }}
  ],
  "ingredients_flat": [
    {{
      "name": "Group Name",
      "type": "group"
    }},
    {{
      "amount": "1",
      "unit": "lb",
      "name": "ingredient name",
      "notes": "optional note",
      "converted": {{
        "2": {{ "amount": "450", "unit": "g" }}
      }},
      "type": "ingredient"
    }}
  ],
  "instructions_flat": [
    {{
      "text": "<p><strong>Step 1:</strong> Detailed instruction text here.</p>",
      "type": "instruction",
      "image_url": ""
    }}
  ],
  "video_embed": "",
  "notes": "<p>Tips, substitutions, and storage instructions.</p>",
  "nutrition": {{
    "calories": 350,
    "carbohydrates": 40,
    "protein": 15,
    "fat": 12,
    "saturated_fat": 5,
    "cholesterol": 60,
    "sodium": 400,
    "potassium": 300,
    "fiber": 3,
    "sugar": 8,
    "vitamin_a": 500,
    "vitamin_c": 10,
    "calcium": 100,
    "iron": 2
  }},
  "custom_fields": {{}},
  "ingredient_links_type": "global"
}}

Rules:
- Fill every field with data from the article.
- Times are strings representing integers in minutes.
- Leave a field empty (or 0) if info is missing.
- Do NOT wrap the JSON in backticks or markdown.

ARTICLE:
{full_recipe}""",
        "description": "Recipe JSON - placeholder: {full_recipe}",
    },
    "meta_description": {
        "value": """You are an SEO expert for a US food blog.

Write a single meta description (max 140 characters) for this recipe article.

Rules:
- One short, clear sentence.
- No emojis.
- Make people want to click.
- Return ONLY the meta description, nothing else.
- DO NOT use this character: -
- Use ONLY standard ASCII English punctuation: . , ? ! : ; ' " ( ) [ ] /

Recipe: {recipe_title}""",
        "description": "Meta description - placeholder: {recipe_title}",
    },
    "category": {
        "value": """You are a food classification expert.

Choose the BEST matching category for the following recipe.
Respond ONLY with one of these exact category names:
Breakfast, Dinner, Salad, Dessert, Snacks, All Recipes, Drinks, Lunch

No other text or explanation.

Recipe: {recipe_title}""",
        "description": "Category - placeholder: {recipe_title}",
    },
    "pinterest_title": {
        "value": """You are a Pinterest food blogger with 10 years of success.

Write a Pin Title for this recipe article.

Rules:
- Max 100 characters.
- Compelling and clickable.
- Include the main focus keyphrase if possible.
- Return ONLY the title on one line, nothing else.
- DO NOT use this character: -
- Use ONLY standard ASCII English punctuation: . , ? ! : ; ' " ( ) [ ] /

Recipe: {recipe_title}""",
        "description": "Pinterest title - placeholder: {recipe_title}",
    },
    "pinterest_description": {
        "value": """You are a Pinterest food blogger with 10 years of success.

Write a Pin Description for this recipe article.

Rules:
- Natural, conversational tone.
- 240 to 330 characters total.
- Similar style to these examples:
  - This Chocolate Cupcake recipe is my go-to for birthday parties and bake sales, since they are perfectly moist and oh-so chocolatey. Top them with our chocolate frosting, and you have the ultimate chocolate lover's cupcake!
  - Easy Croissant French Toast Casserole with fresh berries is the best crowd-pleasing breakfast recipe. Refrigerate overnight for easy serving.
  - Relive your favorite childhood mornings with this incredibly easy Fruity Pebbles Breakfast Bread! It's fast, fun, and packed with colorful cereal goodness. Perfect for breakfast, brunch, or a sweet treat anytime. Get ready for smiles!
- Return ONLY the description, nothing else.
- DO NOT use this character: -
- Use ONLY standard ASCII English punctuation: . , ? ! : ; ' " ( ) [ ] /

Recipe: {recipe_title}""",
        "description": "Pinterest description - placeholder: {recipe_title}",
    },
    "pinterest_tags": {
        "value": """You are a Pinterest SEO expert.

Create 5 to 8 Pinterest keywords for this recipe article.

Rules:
- English only.
- Comma-separated list.
- No hashtags.
- No duplicates.
- Example: garlic butter chicken, creamy pasta, weeknight dinner, easy chicken recipe

Return ONLY the comma-separated list, nothing else.

Recipe: {recipe_title}""",
        "description": "Pinterest tags - placeholder: {recipe_title}",
    },
    "pinterest_board": {
        "value": """You are a Pinterest content strategist who selects the best board for each pin.

Choose the single BEST Pinterest board from this list for the recipe below:

{boards_list}

Rules:
- Return EXACTLY one board name from the list above.
- It must match one of the names exactly.
- No extra words or explanation.

Recipe: {recipe_title}""",
        "description": "Pinterest board selection - placeholders: {recipe_title}, {boards_list}",
    },
    "seo_title": {
        "value": """You are an SEO expert for a US food blog.

Write a single SEO title for this recipe article.

Rules:
- Use natural Title Case.
- Use a style like: Easy Chocolate Cupcakes Recipe, Homemade Spaghetti Sauce Recipe, Air Fryer Chicken Wings (Extra Crispy!)
- Include the word "Recipe" unless the title ends with a parenthetical or exclamation tag.
- Make it natural and compelling. Max 60 characters.
- Return ONLY the title on one line, nothing else.
- DO NOT use this character: -
- Use ONLY standard ASCII English punctuation: . , ? ! : ; ' " ( ) [ ] /

Recipe: {recipe_title}""",
        "description": "SEO post title - placeholder: {recipe_title}",
    },
    "focus_keyword": {
        "value": """Create a single focus keyphrase for this recipe article.

Rules:
- 2 to 5 words.
- What a user would type in Google to find this recipe.
- No quotes, no explanations, no punctuation.
- Example: garlic butter chicken pasta

Return ONLY the keyphrase, nothing else.

Recipe: {recipe_title}""",
        "description": "Focus keyphrase - placeholder: {recipe_title}",
    },
    "wp_tags": {
        "value": """Generate 3 to 5 relevant WordPress post tags for this recipe article.

Rules:
- English only.
- Comma-separated list, lowercase.
- No hashtags, no duplicates.
- Short phrases or single words.
- Example: quick dinner, pasta recipe, one-pot meal, weeknight meal

Return ONLY the comma-separated list, nothing else.

Recipe: {recipe_title}""",
        "description": "WordPress post tags - placeholder: {recipe_title}",
    },
    "midjourney_imagine": {
        "value": "/imagine prompt: {source_img} Amateur photo from Reddit. The photo was taken by an amateur using her phone camera. RECIPE NAME: {recipe_name} Recipe --style raw --stylize 30 --iw 3 --v 6.1",
        "description": "Midjourney image prompt - placeholders: {recipe_name}, {source_img}",
    },
    "pinterest_boards_list": {
        "value": "Air Fryer Dinners & Snacks\n30-Minute Weeknight Meals\nBrunch & Breakfast Bakes\nDesserts & Chaos Cakes\nPickle Fix (Dill-icious Recipes)\nRebel Floats & Fun Drinks\nCharcuterie & Party Boards\nOne-Pot & Casserole Comforts\nPasta & Pizza Night\nBBQ & Grilling Classics\nHealthy Salads & Veggie Sides\nSlow Cooker & Instant Pot Comforts\nBread & Pastry Workshop\nProtein-Packed Lunch Prep\nSauces, Dips & Seasonings\nSoups, Stews & Chowders\nCanning, Ferments & Pickles\nKitchen Hacks & How-To Guides\nHoliday & Seasonal Recipes\nBudget-Friendly & 5-Ingredient Meals\nKid-Friendly Snacks & Lunches",
        "description": "Pinterest boards list - one board name per line, used as {boards_list} in the pinterest_board prompt",
    },
}


def get_prompt(prompts: dict[str, str], key: str) -> str:
    """Get prompt value from dict, fallback to default."""
    if prompts and key in prompts:
        return prompts[key]
    if key in DEFAULT_PROMPTS:
        return DEFAULT_PROMPTS[key]["value"]
    return ""
