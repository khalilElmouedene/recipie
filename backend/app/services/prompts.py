"""Configurable prompts for AI generation. Fallback to DEFAULT_PROMPTS when DB is empty."""
from __future__ import annotations

DEFAULT_PROMPTS: dict[str, dict[str, str]] = {
    "article": {
        "value": """You are a professional americain recipe blogger. Your goal is to write a long, SEO-optimized blog article based on the recipe I will provide in english language.

Instructions:

Write in a warm, conversational, and friendly tone, as if you're talking to a friend in the kitchen.

Use the second person ("you") to guide the reader step by step, and occasionally use the first person ("I") to add helpful personal tips.

Use simple, clear language with an inviting, cozy vibe. No jargon.

Format the article in clean HTML, don't add anything to this structure:
- Title of the article: <h1>
- Main sections: <h2>
- Subsections if any: <h3>
- Paragraphs: <p>
- Use lists (<ul>, <li>) for ingredients and tips

DO NOT use this "—" in texts and titles etc...

Use ONLY standard ASCII English punctuation in texts and titles etc...
Allowed characters:
 . , ? ! : ; ' " ( ) [ ] - /

Structure:
<h1> Catchy SEO-optimized title </h1>

- Start with a nostalgic or emotional hook.
- Mention how easy, quick, or memorable the recipe is.

<h2>Why You'll Love {recipe_name}</h2>
<ul>
  <li>Fast</li>
  <li>Easy</li>
  <li>Giftable</li>
  <li>Crowd-pleasing</li>
</ul>

<h2>Ingredients</h2>
- List ingredients and short comments about them.

<h2>How to Make {recipe_name}</h2>
- Step-by-step instructions.

<h2>Substitutions & Additions</h2>
- Suggest swaps and creative upgrades.

<h2>Tips for Success</h2>
- Common mistakes and prep-ahead ideas.

<h2>How to Store {recipe_name}</h2>
- Storage tips, shelf life.

<h2>FAQs</h2>
- Include 2–4 brief questions and answers.

<!-- INSERT INTERNAL & EXTERNAL LINKS INSTRUCTIONS -->

**Internal Links Instructions:**
You must naturally integrate 2–3 internal links from the following list into the body of the article using rich anchor text.
Make sure these links:
- Are placed only where they make contextual sense.
- Use meaningful and descriptive anchor text (no 'click here').
- Are well integrated and flow naturally in the paragraph (homogenised with the content).
- Do not group the links or create a list.

Here are the internal links you may use:
{internal_links}

**External Link Instruction:**
At the very end of the article, add a short sentence encouraging readers to follow the Pinterest account.

Use the word <strong>Pinterest</strong> as the anchor text, linking it to:
{pinterest_url}

Now write the full HTML article using the following recipe:
{new_recipe}""",
        "description": "Article generation - placeholders: {recipe_name}, {new_recipe}, {internal_links}, {pinterest_url}",
    },
    "full_recipe": {
        "value": "Rewrite in English language the following food recipe in a clean and professional format. Only include title, ingredients, and instructions. Do not add commentary.\n\n{original_recipe}",
        "description": "Full recipe rewrite - placeholder: {original_recipe}",
    },
    "recipe_json": {
        "value": """You are an expert recipe-card generator.
Parse the following english food article and return ONLY a JSON object (no backticks, no markdown) that follows THIS schema exactly:

{{
  "name": "Garlic Butter Chicken Bites with Creamy Parmesan Pasta",
  "summary": "<p>Juicy garlic butter chicken bites served over rich, creamy Parmesan pasta—this easy yet elegant meal is perfect for busy weeknights or cozy weekends.</p>",
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
    "cuisine": ["American", "Italian-Inspired"],
    "keyword": ["Garlic Butter Chicken", "Creamy Pasta", "Parmesan"],
    "difficulty": []
  }},
  "equipment": [
    {{ "name": "Large Skillet" }},
    {{ "name": "Large Pot" }},
    {{ "name": "Tongs or Spatula" }}
  ],
  "ingredients_flat": [
    {{
      "name": "For the Garlic Butter Chicken Bites",
      "type": "group"
    }},
    {{
      "amount": "1",
      "unit": "lb",
      "name": "boneless chicken breasts",
      "notes": "cut into bite-sized pieces",
      "converted": {{
        "2": {{ "amount": "450", "unit": "g" }}
      }},
      "type": "ingredient"
    }},
    {{
      "amount": "2",
      "unit": "tbsp",
      "name": "olive oil",
      "notes": "",
      "converted": {{
        "2": {{ "amount": "30", "unit": "ml" }}
      }},
      "type": "ingredient"
    }},
    {{
      "amount": "3",
      "unit": "tbsp",
      "name": "unsalted butter",
      "notes": "",
      "converted": {{
        "2": {{ "amount": "45", "unit": "g" }}
      }},
      "type": "ingredient"
    }},
    {{
      "amount": "3",
      "unit": "cloves",
      "name": "garlic",
      "notes": "minced",
      "converted": {{
        "2": {{ "amount": "3", "unit": "cloves" }}
      }},
      "type": "ingredient"
    }},
    {{
      "name": "For the Creamy Parmesan Pasta",
      "type": "group"
    }},
    {{
      "amount": "12",
      "unit": "oz",
      "name": "fettuccine",
      "notes": "or linguine",
      "converted": {{
        "2": {{ "amount": "340", "unit": "g" }}
      }},
      "type": "ingredient"
    }},
    {{
      "amount": "1.5",
      "unit": "cups",
      "name": "heavy cream",
      "notes": "",
      "converted": {{
        "2": {{ "amount": "360", "unit": "ml" }}
      }},
      "type": "ingredient"
    }},
    {{
      "amount": "1",
      "unit": "cup",
      "name": "Parmesan cheese",
      "notes": "grated",
      "converted": {{
        "2": {{ "amount": "100", "unit": "g" }}
      }},
      "type": "ingredient"
    }}
  ],
  "instructions_flat": [
    {{
      "text": "<p><strong>Step 1:</strong> Cook pasta in a large pot of salted water until al dente. Reserve 1/2 cup of pasta water. Drain and set aside.</p>",
      "type": "instruction",
      "image_url": ""
    }},
    {{
      "text": "<p><strong>Step 2:</strong> In a skillet, heat olive oil over medium-high. Season chicken with paprika, Italian seasoning, salt, and pepper. Sear for 3-4 minutes per side until golden and cooked through. Remove and set aside.</p>",
      "type": "instruction",
      "image_url": ""
    }},
    {{
      "text": "<p><strong>Step 3:</strong> In the same skillet, melt butter and add minced garlic. Saute for 1 minute. Return chicken to the pan and toss in garlic butter.</p>",
      "type": "instruction",
      "image_url": ""
    }}
  ],
  "video_embed": "",
  "notes": "<p>Make it lighter by swapping heavy cream with half-and-half. Store leftovers in the fridge up to 3 days.</p>",
  "nutrition": {{
    "calories": 670,
    "carbohydrates": 40,
    "protein": 38,
    "fat": 42,
    "saturated_fat": 22,
    "cholesterol": 160,
    "sodium": 580,
    "potassium": 550,
    "fiber": 2,
    "sugar": 2,
    "vitamin_a": 1100,
    "vitamin_c": 6,
    "calcium": 280,
    "iron": 2
  }},
  "custom_fields": {{}},
  "ingredient_links_type": "global"
}}

Rules:
• Fill every blank with info from the article.
• Times are integers in minutes.
• Leave a field empty (or 0) if info is missing.
• Do NOT wrap the JSON in backticks or markdown.

ARTICLE:
{article}""",
        "description": "Recipe JSON - placeholder: {article}",
    },
    "meta_description": {
        "value": """You are an SEO expert.

Write a single meta description (≤ 140 characters) for this article.
Rules:
- One short, clear sentence.
- No emojis.
- Make people want to click.
- Return ONLY the meta description, nothing else.

DO NOT use this "—" in texts and titles etc...

Use ONLY standard ASCII English punctuation in texts and titles etc...
Allowed characters:
. , ? ! : ; ' " ( ) [ ] - /

Article:
{article}""",
        "description": "Meta description - placeholder: {article}",
    },
    "category": {
        "value": """Wähle die BESTPASSENDE Kategorie für den folgenden deutschen Artikel.
Antworte nur mit dem Kategorienamen, der GENAU so in dieser Liste steht:
Snacks, All Recipes, Breakfast, Desserts, Dinner, Drinks, Lunch

Artikel:
{article}""",
        "description": "Category - placeholder: {article}",
    },
    "pinterest_title": {
        "value": """You are a Pinterest food blogger with 10 years of success.

Write a Pin Title for this article.

Rules:
- Max 100 characters.
- Compelling and clickable.
- Include the main focus keyphrase if possible.
- Return ONLY the title on one line.

DO NOT use this "—" in texts and titles etc...

Use ONLY standard ASCII English punctuation in texts and titles etc...
Allowed characters:
. , ? ! : ; ' " ( ) [ ] - /

Article:
{article}""",
        "description": "Pinterest title - placeholder: {article}",
    },
    "pinterest_description": {
        "value": """You are a Pinterest food blogger with 10 years of success.

Write a Pin Description for this article.

Rules:
- Natural, conversational tone.
- 240–330 characters.
- Similar style to these examples:
  - This Chocolate Cupcake recipe is my go-to for birthday parties and bake sales, since they are perfectly moist and oh-so chocolatey. Top them with our chocolate frosting, and you have the ultimate chocolate lover's cupcake!
  - Easy Croissant French Toast Casserole with fresh berries is the best crowd-pleasing breakfast recipe. Refrigerate overnight for easy serving.
  - Relive your favorite childhood mornings with this incredibly easy Fruity Pebbles Breakfast Bread! It's fast, fun, and packed with colorful cereal goodness. Perfect for breakfast, brunch, or a sweet treat anytime. Get ready for smiles!
- Return ONLY the description, nothing else.

DO NOT use this "—" in texts and titles etc...

Use ONLY standard ASCII English punctuation in texts and titles etc...
Allowed characters:
. , ? ! : ; ' " ( ) [ ] - /

Article:
{article}""",
        "description": "Pinterest description - placeholder: {article}",
    },
    "pinterest_tags": {
        "value": """Create 5–8 Pinterest keywords for this article.

Rules:
- English.
- Comma-separated.
- No hashtags.
- No duplicates.
- Example: garlic butter chicken, creamy pasta, weeknight dinner

Return ONLY the comma-separated list.

Article:
{article}""",
        "description": "Pinterest tags - placeholder: {article}",
    },
    "pinterest_board": {
        "value": """Choose the single BEST Pinterest board from this list for the article below:

{boards_list}

Rules:
- Return EXACTLY one board name.
- It must match one of the names above exactly.
- No extra words.

Article:
{article}""",
        "description": "Pinterest board selection - placeholders: {article}, {boards_list}",
    },
    "seo_title": {
        "value": """You are an SEO expert for a US food blog.

Task: Write a single SEO title for this recipe article.

Rules:
- Use natural Title Case.
- Use a style like:
  • Easy Chocolate Cupcakes Recipe
  • Homemade Spaghetti Sauce Recipe
  • Air Fryer Chicken Wings (Extra Crispy!)
- Include the word "Recipe" unless the title ends with a parenthetical or exclamation tag.
- Make it natural and compelling.
- Return ONLY the title on one line, nothing else.

DO NOT use this "—" in texts and titles etc...

Use ONLY standard ASCII English punctuation in texts and titles etc...
Allowed characters:
. , ? ! : ; ' " ( ) [ ] - /

Article:
{article}""",
        "description": "SEO post title - placeholder: {article}",
    },
    "focus_keyword": {
        "value": """Create a single focus keyphrase for this article.

Rules:
- 2–5 words.
- What a user would type in Google.
- No quotes, no explanations.
- Example: garlic butter chicken pasta

DO NOT use this "—" in texts and titles etc...

Use ONLY standard ASCII English punctuation in texts and titles etc...
Allowed characters:
. , ? ! : ; ' " ( ) [ ] - /

Return ONLY the keyphrase.

Article:
{article}""",
        "description": "Focus keyphrase - placeholder: {article}",
    },
    "wp_tags": {
        "value": """(The tags should be in English) Gib 3–5 relevante Tags (Komma-getrennt, nur Kleinbuchstaben) für diesen englischsprachigen Rezept-Artikel zurück. Keine Hashtags, keine Wiederholungen.

Artikel:
{article}""",
        "description": "WordPress post tags - placeholder: {article}",
    },
    "midjourney_imagine": {
        "value": "/imagine prompt: {img_url} Amateur photo from Reddit. The photo was taken by an amateur using her phone camera. RECIPE NAME: {recipe_name} Recipe --style raw --stylize 30 --iw 3 --v 6.1",
        "description": "Midjourney image prompt - placeholders: {recipe_name}, {img_url}",
    },
    "pinterest_boards_list": {
        "value": "Air Fryer Dinners & Snacks\n30-Minute Weeknight Meals\nBrunch & Breakfast Bakes\nDesserts & Chaos Cakes\nPickle Fix (Dill-icious Recipes)\nRebel Floats & Fun Drinks\nCharcuterie & Party Boards\nOne-Pot & Casserole Comforts\nPasta & Pizza Night\nBBQ & Grilling Classics\nHealthy Salads & Veggie Sides\nSlow Cooker & Instant Pot Comforts\nBread & Pastry Workshop\nProtein-Packed Lunch Prep\nSauces, Dips & Seasonings\nSoups, Stews & Chowders\nCanning, Ferments & Pickles\nKitchen Hacks & How-To Guides\nHoliday & Seasonal Recipes\nBudget-Friendly & 5-Ingredient Meals\nKid-Friendly Snacks & Lunches",
        "description": "Pinterest boards list - one board name per line, used as {boards_list} in the pinterest_board prompt",
    },
    "facebook_video_script": {
        "value": """Write a hooked, viral Facebook recipe video voice-over for:

{recipe_title}

Requirements:
- About 8 seconds when spoken
- Start with a strong hook
- Conversational, natural human tone
- Make viewers curious
- Mention that the full recipe is in the first comment
- Short sentences
- No emojis
- No hashtags

Return only the voice-over script.""",
        "description": "Facebook video voice-over - placeholder: {recipe_title}",
    },
    "facebook_recipe_card": {
        "value": """Transform this exact food screenshot into a premium infographic recipe card.

Keep the exact dish, camera angle, composition, plating, and food styling.
Add only an elegant recipe-card layout, an ingredients section, and realistic shadows.
Use a premium food-magazine look, vertical composition, and crisp readable typography.

Recipe title:
{recipe_title}""",
        "description": "Facebook recipe-card image edit - placeholder: {recipe_title}",
    },
}


def get_prompt(prompts: dict[str, str], key: str) -> str:
    """Get prompt value from dict, fallback to default."""
    if prompts and key in prompts:
        return prompts[key]
    if key in DEFAULT_PROMPTS:
        return DEFAULT_PROMPTS[key]["value"]
    return ""
