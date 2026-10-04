"""Configurable prompts for AI generation. Fallback to DEFAULT_PROMPTS when DB is empty."""
from __future__ import annotations

DEFAULT_PROMPTS: dict[str, dict[str, str]] = {
    "article": {
        "value": """You are a professional recipe blogger. Write in the same language as the supplied recipe. Write 750-1000 useful body words with specific cooking guidance.

Primary search phrase: {focus_keyword}
Use this exact phrase naturally in the H1, first paragraph and one relevant H2 or H3. Preserve ingredient quantities and instructions. Do not invent personal experience or testing stories.

Instructions:

Write in a warm, conversational, and friendly tone, as if you're talking to a friend in the kitchen.

Use the second person to guide the reader step by step with practical cooking tips.

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
When verified URLs are available below, naturally integrate relevant internal links into the body using descriptive anchor text. Otherwise omit them.
Make sure these links:
- Are placed only where they make contextual sense.
- Use meaningful and descriptive anchor text (no 'click here').
- Are well integrated and flow naturally in the paragraph (homogenised with the content).
- Do not group the links or create a list.

Here are the internal links you may use:
{internal_links}

**External Link Instruction:**
If a Pinterest account URL is supplied below, add a short sentence at the end encouraging readers to follow it. Otherwise omit this sentence and link.

Use the word <strong>Pinterest</strong> as the anchor text, linking it to:
{pinterest_url}

Now write the full HTML article using the following recipe:
{new_recipe}""",
        "description": "Article generation - placeholders: {recipe_name}, {new_recipe}, {internal_links}, {pinterest_url}, {focus_keyword}",
    },
    "full_recipe": {
        "value": "Rewrite the complete recipe in its original language in a clean, professional format. Preserve all supplied ingredients, quantities, temperatures, times and instructions. Include title, ingredients and instructions only. If the input is just a dish name, draft a recipe for that dish. Do not claim it has been tested.\n\n{original_recipe}",
        "description": "Full recipe rewrite - placeholder: {original_recipe}",
    },
    "recipe_json": {
        "value": """Map the supplied recipe into this WP Recipe Maker JSON shape. Return one JSON object only.
Preserve the recipe language, ingredient quantities, method and supplied times.
Populate every ingredient and instruction, not just the single example entry.
Use integer minutes for times. Leave unknown times/servings at 0 and unknown nutrition empty.
Do not invent ratings, author claims, nutrition, or ingredients from unrelated examples.

{{
  "name": "",
  "summary": "",
  "servings": 0,
  "servings_unit": "",
  "prep_time": 0,
  "cook_time": 0,
  "total_time": 0,
  "tags": {{
    "course": [],
    "cuisine": [],
    "keyword": []
  }},
  "equipment": [
    {{
      "name": ""
    }}
  ],
  "ingredients_flat": [
    {{
      "type": "ingredient",
      "amount": "",
      "unit": "",
      "name": "",
      "notes": ""
    }}
  ],
  "instructions_flat": [
    {{
      "type": "instruction",
      "text": ""
    }}
  ],
  "nutrition": {{}},
  "notes": ""
}}

Canonical recipe:
{full_recipe}

Article context:
{article}""",
        "description": "Recipe JSON - placeholders: {article}, {full_recipe}",
    },
    "meta_description": {
        "value": """You are an SEO expert.

Write a single meta description (≤ 140 characters) for this article.
Use the article's language and include the exact primary search phrase: {focus_keyword}
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
        "description": "Meta description - placeholders: {article}, {focus_keyword}",
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
        "value": """You are an SEO editor for a recipe blog. Use the article's language and natural capitalization for that language.

Task: Write a single SEO title for this recipe article.

Rules:
- Include the exact search phrase near the beginning: {focus_keyword}
- Aim for at most 60 characters, with a maximum of 70.
- Use a style like:
  • Easy Chocolate Cupcakes Recipe
  • Homemade Spaghetti Sauce Recipe
  • Air Fryer Chicken Wings (Extra Crispy!)
- Use a natural word for recipe in the article's language only when it fits.
- Make it natural and compelling.
- Return ONLY the title on one line, nothing else.

DO NOT use this "—" in texts and titles etc...

Use ONLY standard ASCII English punctuation in texts and titles etc...
Allowed characters:
. , ? ! : ; ' " ( ) [ ] - /

Article:
{article}""",
        "description": "SEO post title - placeholders: {article}, {focus_keyword}",
    },
    "focus_keyword": {
        "value": """Create a single focus keyphrase for this article.

Rules:
- 2–5 words.
- What a user would type in Google.
- Use the supplied recipe's language and preserve accented letters.
- Return a suggestion only; do not invent search volume or competition data.
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
        "value": """Return 3-5 relevant WordPress tags in the same language as this recipe article. Use lowercase, commas, no hashtags and no duplicate tags.

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
        "value": """Transform this EXACT food image into a premium infographic recipe card.

IMPORTANT:
- Keep the EXACT same food image
- Keep the same dish
- Keep the same camera angle
- Keep the same composition
- Keep the same plating
- Keep the same food styling

Add only:
- elegant recipe card layout
- infographic style
- ingredients section
- realistic shadows

Style:
- premium Pinterest recipe infographic
- luxury food magazine
- ultra realistic
- vertical composition
- high quality

Recipe title:
{recipe_title}""",
        "description": "Facebook recipe-card image edit - placeholder: {recipe_title}",
    },
}


def get_prompt(prompts: dict[str, str], key: str) -> str:
    """Get prompt value from dict, fallback to default."""
    if prompts and key in prompts and prompts[key].strip():
        return prompts[key]
    if key in DEFAULT_PROMPTS:
        return DEFAULT_PROMPTS[key]["value"]
    return ""
