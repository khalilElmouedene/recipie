"""Configurable prompts for AI generation. Fallback to DEFAULT_PROMPTS when DB is empty."""
from __future__ import annotations

DEFAULT_PROMPTS: dict[str, dict[str, str]] = {
    "article": {
        "value": """Generate a complete, fully written recipe article for '{recipe_title}' based on the recipe details: {full_recipe}. The article must be at least 1300 words and include:

1. COMPLETE ARTICLE STRUCTURE:
- Engaging introduction (200-300 words)
- Why you'll love this recipe section (300-400 words)
- Why you should try this recipe section (300-400 words)
- Ingredients and necessary utensils with detailed list and quantities (300-500 words)
- Detailed recipe steps with practical tips (300-400 words)
- FAQ section with 4-6 relevant questions and answers
- Conclusion (100-200 words)

2. SEO OPTIMIZATION:
- Use focus keyword '{recipe_title}' naturally throughout
- Include H2, H3, H4 headings with keywords
- {internal_links}
- Write meta description (will be used separately)

3. FORMATTING:
- Output as clean HTML without <head>, <body> tags
- Start directly with H1 for the title
- Use proper HTML tags for lists, headings, paragraphs
- Make it mobile-friendly and readable

4. CONTENT QUALITY:
- Unique, well-structured content
- Perfect grammar and spelling
- Natural and engaging tone
- No content duplication

Write the complete article now with all sections fully developed.""",
        "description": "Article generation - placeholders: {recipe_title}, {full_recipe}, {external_links}, {internal_links}",
    },
    "full_recipe_system": {
        "value": "You are a professional recipe writer.",
        "description": "System message for full recipe generation",
    },
    "full_recipe_user": {
        "value": "COPY-PASTE READY Long And Easy To Read Food Recipe : {recipe_title} no additional text with title and Ingredients, write recipe (ingredients, instructions, nutrition) based on ingredients",
        "description": "User prompt for full recipe - placeholder: {recipe_title}",
    },
    "recipe_json_system": {
        "value": "You are a professional recipe creator that outputs perfect JSON for WP Recipe Maker with ALL required fields.",
        "description": "System message for recipe JSON generation",
    },
    "recipe_json_user": {
        "value": """Generate a complete recipe for "{full_recipe}" that can be directly imported into WP Recipe Maker plugin.

Return ONLY valid JSON exactly matching this structure (no markdown, no extra text):
{{
    "type": "wprm_recipe",
    "name": "Full recipe title",
    "summary": "A 1-2 sentence enticing description of the recipe.",
    "author": {{"id": 1, "name": "Recipe Creator"}},
    "servings": 4,
    "servings_unit": "servings",
    "cost": "",
    "prep_time": 15,
    "cook_time": 30,
    "total_time": 45,
    "custom_time": 0,
    "custom_time_label": "",
    "rating": {{"count": 0, "total": 0, "average": 0}},
    "tags": {{
        "course": ["Dessert"],
        "cuisine": ["American"],
        "keyword": ["keyword-specific-to-recipe", "main-ingredient", "cooking-method", "occasion"],
        "difficulty": "easy"
    }},
    "equipment": [
        {{"name": "Equipment 1"}},
        {{"name": "Equipment 2"}}
    ],
    "ingredients_flat": [
        {{"uid": "group_1", "name": "Main Ingredients", "type": "group"}},
        {{"uid": "ingredient_1", "name": "ingredient name", "amount": "1", "unit": "cup", "notes": "", "group": "group_1", "type": "ingredient"}},
        {{"uid": "ingredient_2", "name": "ingredient name", "amount": "1/2", "unit": "tablespoon", "notes": "optional note", "group": "group_1", "type": "ingredient"}},
        {{"uid": "ingredient_3", "name": "ingredient name", "amount": "2", "unit": "cups", "notes": "", "group": "group_1", "type": "ingredient"}}
    ],
    "instructions_flat": [
        {{"uid": "group_1", "name": "Instructions", "type": "group"}},
        {{"uid": "instruction_1", "text": "Detailed first step.", "group": "group_1", "type": "instruction"}},
        {{"uid": "instruction_2", "text": "Detailed second step.", "group": "group_1", "type": "instruction"}},
        {{"uid": "instruction_3", "text": "Detailed third step.", "group": "group_1", "type": "instruction"}}
    ],
    "nutrition": {{
        "calories": "350 kcal",
        "carbohydrates": "50 g",
        "protein": "5 g",
        "fat": "15 g",
        "saturated_fat": "8 g",
        "cholesterol": "45 mg",
        "sodium": "80 mg",
        "potassium": "",
        "fiber": "3 g",
        "sugar": "10 g",
        "vitamin_a": "",
        "vitamin_c": "",
        "calcium": "",
        "iron": ""
    }},
    "custom_fields": {{}},
    "notes": "Tips, substitutions, and storage instructions for this recipe."
}}

Rules:
- ingredients_flat: start with one group object, then list all 6-10 ingredients with uid, name, amount, unit, notes, group, type
- instructions_flat: start with one group object, then list 5-8 detailed steps with uid, text, group, type
- keywords must be recipe-specific (main ingredient, cooking method, flavor, occasion) — NOT generic words like "easy" or "delicious"
- nutrition values must be strings with units exactly as shown (e.g. "350 kcal", "50 g", "80 mg")
- Return ONLY the JSON object, absolutely nothing else""",
        "description": "Recipe JSON - placeholder: {full_recipe}",
    },
    "meta_description_system": {
        "value": "You are an SEO expert.",
        "description": "System message for meta description",
    },
    "meta_description_user": {
        "value": "Generate a meta description of 155 characters for the recipe with the Main Keyword '{recipe_title}'",
        "description": "Meta description - placeholder: {recipe_title}",
    },
    "category_system": {
        "value": "You are a food classification expert.",
        "description": "System message for category",
    },
    "category_user": {
        "value": "Based solely on the recipe name '{recipe_title}', which category does it best fit into? Only respond with one of these exact words: Breakfast, Dinner, Salad, or Dessert. No other text or explanation.",
        "description": "Category - placeholder: {recipe_title}",
    },
    "pinterest_title_system": {
        "value": "You are a Pinterest marketing expert.",
        "description": "System message for Pinterest pin title",
    },
    "pinterest_title_user": {
        "value": "Create a clear and engaging Pinterest Pin title for '{recipe_title}'. Keep it under 100 characters, include common Pinterest search keywords, and make it appeal to users looking for new recipe ideas",
        "description": "Pinterest title - placeholder: {recipe_title}",
    },
    "pinterest_description_system": {
        "value": "You are a Pinterest content specialist.",
        "description": "System message for Pinterest description",
    },
    "pinterest_description_user": {
        "value": "Using the following title and keywords '{recipe_title}', create a Pinterest-friendly description that is clear, keyword-rich, and written in an engaging, natural tone. Avoid hype or sales-driven phrases. Compose 2-3 sentences that blend the keywords smoothly, evoke seasonal or emotional appeal, and close with a subtle CTA like 'Learn more' or 'Explore the recipe'",
        "description": "Pinterest description - placeholder: {recipe_title}",
    },
    "pinterest_tags_system": {
        "value": "You are a Pinterest SEO expert.",
        "description": "System message for Pinterest tags",
    },
    "pinterest_tags_user": {
        "value": "Generate Pinterest pin relevant tags for '{recipe_title}' as a comma-separated list. Include 10-15 relevant tags that are commonly searched on Pinterest for recipes",
        "description": "Pinterest tags - placeholder: {recipe_title}",
    },
    "midjourney_imagine": {
        "value": "/imagine prompt:  {recipe_name} | Amateur photo, taken with an iPhone 15 Pro  |  --ar 5:6 --v 7   --sref {source_img} ",
        "description": "Midjourney image prompt - placeholders: {recipe_name}, {source_img}",
    },
}


def get_prompt(prompts: dict[str, str], key: str) -> str:
    """Get prompt value from dict, fallback to default."""
    if prompts and key in prompts:
        return prompts[key]
    if key in DEFAULT_PROMPTS:
        return DEFAULT_PROMPTS[key]["value"]
    return ""
