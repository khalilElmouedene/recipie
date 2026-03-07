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
- Add 1 external link to Pinterest
- Add 5-7 internal links naturally distributed
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
        "value": """Generate a complete recipe for "{full_recipe}" that can be directly imported into WP Recipe Maker plugin via REST API.

Return ONLY valid JSON matching this exact structure (no markdown, no commentary):
{{
    "name": "Full recipe title",
    "summary": "2-sentence enticing description of the recipe",
    "author": {{"id": 1, "name": ""}},
    "servings": 4,
    "servings_unit": "servings",
    "prep_time": 10,
    "cook_time": 20,
    "total_time": 30,
    "tags": {{
        "course": ["Dessert"],
        "cuisine": ["American"],
        "keyword": ["recipe-specific-keyword1", "recipe-specific-keyword2", "recipe-specific-keyword3", "recipe-specific-keyword4"]
    }},
    "equipment": [{{"name": "Equipment Name"}}],
    "ingredients": [
        {{
            "name": "",
            "ingredients": [
                {{"amount": "1/2", "unit": "cup", "name": "ingredient name", "notes": "optional note"}},
                {{"amount": "2", "unit": "tablespoons", "name": "ingredient name", "notes": ""}},
                {{"amount": "", "unit": "", "name": "ingredient name", "notes": ""}}
            ]
        }}
    ],
    "instructions": [
        {{
            "name": "",
            "instructions": [
                {{"name": "", "text": "First step instruction text."}},
                {{"name": "", "text": "Second step instruction text."}},
                {{"name": "", "text": "Third step instruction text."}}
            ]
        }}
    ],
    "nutrition": {{
        "calories": 350,
        "carbohydrates": 50,
        "protein": 5,
        "fat": 15,
        "saturated_fat": 9,
        "cholesterol": 45,
        "sodium": 80,
        "fiber": 3,
        "sugar": 40
    }},
    "notes": "Tips, substitutions, and variations for this recipe."
}}

Rules:
- Use at least 6-10 ingredients with realistic amounts and units
- Write 5-8 detailed instruction steps
- All nutrition values must be plain numbers (no units, no strings)
- Keywords must be recipe-specific (ingredient names, cooking method, occasion)
- Return ONLY the JSON object, nothing else""",
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
