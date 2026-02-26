import re, time, traceback, requests, json 
from dotenv import load_dotenv
from Google import Create_Service
import ssl
from googleapiclient.errors import HttpError
import xml.etree.ElementTree as ET          # ← NEW
import random
from openai import OpenAI    # ← NEW

print("⏳ Waiting 2 hours before starting...")
#time.sleep(1800)
print("✅ Starting the script now.")


#Link Random
def pick_two_alt_links(multiline_cell: str) -> tuple[str, str]:
    """
    From a multi-line cell where each line is a URL:
    - Exclude the first line (link1)
    - Randomly pick 2 links from the remaining lines (link2..)
    - If fewer than 2 candidates exist, fall back gracefully
    """
    if not multiline_cell:
        return "", ""
    links = [ln.strip() for ln in multiline_cell.splitlines() if ln.strip()]
    # Exclude the first link (link1)
    candidates = links[1:] if len(links) > 1 else []
    if len(candidates) >= 2:
        chosen = random.sample(candidates, 2)
        return chosen[0], chosen[1]
    elif len(candidates) == 1:
        # If only one alternative exists, duplicate it (or return "", "" if you prefer)
        return candidates[0], candidates[0]
    else:
        return "", ""

    
# ── SEO / Pinterest helpers ────────────────────────────────────────────────────
def to_title_case(s: str) -> str:
    # Keep acronyms & digits; Title-Case words; avoid shouting
    return " ".join(w if w.isupper() and len(w) > 1 else w.capitalize() for w in re.split(r"(\s+)", s))

def format_seo_title(raw: str) -> str:
    """
    Normalize SEO titles.
    - Title Case (preserving text inside parentheses)
    - Append ' Recipe' ONLY for food/recipe topics
      (skip for DIY/crafts/experiments/kitchen hacks/how-to)
    """
    if not raw:
        return ""
    t = raw.strip()
    # Remove trailing punctuation spaces
    t = re.sub(r"\s+([)!?.])$", r"\1", t)
    # Title-Case but preserve stuff inside parentheses
    parts = re.split(r"(\(.*?\))", t)
    parts = [p if p.startswith("(") and p.endswith(")") else to_title_case(p) for p in parts]
    t = "".join(parts)

    has_recipe   = re.search(r"\brecipe\b", t, re.I) is not None
    ends_with_tag = re.search(r"[)\!]\s*$", t) is not None  # ')', '!'

    # NEW: detect non-food topics where we must NOT append "Recipe"
    non_food = re.search(
        r"\b(DIY|craft|experiment|science|how[- ]?to|hack|lantern|suncatcher|glow[- ]?in[- ]?the[- ]?dark|bubbles)\b",
        t, re.I
    ) is not None

    if not has_recipe and not ends_with_tag and not non_food:
        t = t.rstrip(".").rstrip() + " Recipe"

    # Clean double spaces
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t

def smart_truncate(text: str, max_len: int) -> str:
    """
    Truncate without cutting words. Prefer sentence boundary; otherwise last space.
    Ensures final length ≤ max_len. Adds no ellipsis (SEO meta best practice).
    """
    if not text:
        return ""
    s = " ".join(text.strip().split())  # normalize whitespace
    if len(s) <= max_len:
        return s
    # Try the last period within limit
    cutoff = s[:max_len]
    last_dot = cutoff.rfind(".")
    if last_dot >= max_len * 0.5:  # only if the sentence is reasonably long
        return cutoff[:last_dot + 1].strip()
    # Otherwise trim to last space
    last_space = cutoff.rfind(" ")
    if last_space > 0:
        return cutoff[:last_space].rstrip(". ").strip()
    return cutoff.strip()

def normalize_meta_description(raw: str, max_len: int = 140) -> str:
    s = raw or ""
    s = re.sub(r"\s+", " ", s).strip()
    s = smart_truncate(s, max_len)
    # Encourage period at end (optional but clean)
    if s and s[-1].isalnum():
        s += "."
    return s

def normalize_pin_description(raw: str, min_len: int = 240, max_len: int = 330) -> str:
    """
    Force Pinterest description into 240–330 chars.
    - If longer than max, trim smartly.
    - If shorter than min, gently extend with a friendly CTA.
    """
    s = (raw or "").strip().replace("\n", " ")
    s = re.sub(r"\s+", " ", s)
    if len(s) > max_len:
        s = smart_truncate(s, max_len)
    if len(s) < min_len:
        pad = ""
        s = (s + pad).strip()
        if len(s) > max_len:
            s = smart_truncate(s, max_len)
        # Ensure we met the minimum; if still short, add a tiny nudge
        if len(s) < min_len:
            s = smart_truncate(s + "", max_len)
    return s


def safe_batch_update(svc, body, retries: int = 5, pause: float = 1.0) -> None:
    """
    Effectue svc.values().batchUpdate avec relance automatique
    en cas de coupure TLS (ssl.SSLEOFError) ou d’erreurs réseau 5xx.
    """
    for attempt in range(1, retries + 1):
        try:
            svc.values().batchUpdate(
                spreadsheetId=SPREADSHEET_ID,
                body=body
            ).execute(num_retries=0)      # on gère le retry nous‑mêmes
            return                         # ← succès : on sort

        except ssl.SSLEOFError:
            err = f"SSL EOF (try {attempt}/{retries}) → retry"

        except HttpError as e:
            if e.resp.status >= 500:       # 5xx = incident transitoire
                err = f"HTTP {e.resp.status} (try {attempt}/{retries}) → retry"
            else:                          # 4xx = vraie erreur → stop
                raise

        except Exception:
            raise                           # toute autre exception → stop

        print(err)
        time.sleep(pause)
        pause *= 2                          # back‑off exponentiel


load_dotenv()
AST_RE = re.compile(r"\*{1,3}")        # *  **  ou  ***

def clean_stars(text: str) -> str:
    """
    Supprime tous les groupes d'astérisques isolés (*, ** ou ***).
    On ne touche pas aux balises HTML ni aux entités (&ast;).
    """
    return AST_RE.sub("", text)

def strip_label_prefix(value: str) -> str:
    """
    Remove prefixes like 'SEO Title:' or 'Pin Title:' if the model adds them.
    """
    value = (value or "").strip()
    value = re.sub(r"^[A-Za-z ]*:\s*", "", value)
    return value.strip()



# --------- OpenAI -------------------------------------------------------- #
client = OpenAI(api_key="sk-proj-7stnlpiDcC2ikLMzBBYdSzsPaSlyl65ExXOotRI-R66A4n58nrJKNVBk78mwm_CbznVMUYFpi-T3BlbkFJg8Yeud1x-4APcsVylOS7mVkr57fIU7-bgNMK9ZOsBEiZoSrFUKZiWqCsjdP_SSkd2O90")  # ← put your real OpenAI key instead of X

def call_openai(prompt: str) -> str:
    """
    Sends a prompt to OpenAI and returns the text response.
    """
    response = client.chat.completions.create(
        model="gpt-4.1-mini",   # you can change model later if you want
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
    )
    return response.choices[0].message.content.strip()

def generate_with_retry(prompt: str, desc: str, max_tries: int = 3, min_len: int = 3) -> str:
    """
    Call OpenAI with retries until we get a non-empty response
    (or until max_tries is reached).
    """
    last_text = ""
    for attempt in range(1, max_tries + 1):
        try:
            text = call_openai(prompt).strip()
        except Exception as e:
            print(f"{desc}: error on attempt {attempt}/{max_tries}: {e}")
            text = ""
        if len(text) >= min_len:
            if attempt > 1:
                print(f"{desc}: succeeded on attempt {attempt}.")
            return text
        print(f"{desc}: empty/too short on attempt {attempt}/{max_tries}, retrying...")
        last_text = text
        time.sleep(5)
    return last_text




# --------- Google Sheets ------------------------------------------------- #
CLIENT_SECRET_FILE = "file.json"
service = Create_Service(
    CLIENT_SECRET_FILE, "sheets", "v4",
    ["https://www.googleapis.com/auth/spreadsheets"]
)
SPREADSHEET_ID = "1BswVAS_pUuB1pkF6_iNHuQ5yOZbBRSQInFN_YEFflLE"
sheet = service.spreadsheets()
values = sheet.values().get(
    spreadsheetId=SPREADSHEET_ID, range="Sheet1!A:Z"
).execute().get("values", [])

if not values:
    print("No data found."); quit()

# --------- Midjourney wrapper ------------------------------------------- #
class MidjourneyApi:
    def __init__(self, prompt, application_id, guild_id,
                 channel_id, version, cmd_id, authorization):
        self.prompt          = prompt
        self.application_id  = application_id
        self.guild_id        = guild_id
        self.channel_id      = channel_id
        self.version         = version
        self.cmd_id          = cmd_id
        self.authorization   = authorization

        self.message_id = ""
        self.custom_ids = []      # contiendra les IDs des boutons U1‑U4
        self.image_urls = []      # URLs finales des images upscalées

    # 1) envoyer la commande /imagine
    def send_message(self):
        url = "https://discord.com/api/v9/interactions"
        payload = {
            "type": 2,
            "application_id": self.application_id,
            "guild_id": self.guild_id,
            "channel_id": self.channel_id,
            "session_id": "xxxxx",
            "data": {
                "version": self.version,
                "id": self.cmd_id,
                "name": "imagine",
                "type": 1,
                "options": [
                    {"type": 3, "name": "prompt", "value": self.prompt}
                ],
                "application_command": {"id": self.cmd_id},
                "attachments": []
            }
        }
        headers = {"Authorization": self.authorization,
                   "Content-Type": "application/json"}
        requests.post(url, headers=headers, json=payload)

    # 2) récupérer le premier message (miniatures + boutons U/V)
    def get_message(self, wait_sec: int = 90, max_retry: int = 3):
        """
        Essaie plusieurs fois de récupérer le premier message Midjourney.
        Si au bout de max_retry tentatives on n’a toujours pas les boutons U1-U4,
        on laisse self.custom_ids vide : choose_images() sautera simplement.
        """
        headers = {
            "Authorization": self.authorization,
            "Content-Type": "application/json"
        }
        for attempt in range(1, max_retry + 1):
            print(f"⏳  Attente Midjourney… (essai {attempt}/{max_retry})")
            time.sleep(wait_sec)

            r = requests.get(
                f"https://discord.com/api/v9/channels/{self.channel_id}/messages",
                headers=headers, timeout=30
            )
            r.raise_for_status()
            msgs = r.json()
            if not msgs:
                continue                       # rien reçu → on ré-essaye

            first_msg = msgs[0]
            self.message_id = first_msg["id"]

            # --- présence des composants ? -----------------------------
            comps_list = first_msg.get("components", [])
            if comps_list and comps_list[0].get("components"):
                comps = comps_list[0]["components"]
                self.custom_ids = [
                    c["custom_id"] for c in comps
                    if c.get("label") in {"U1", "U2", "U3", "U4"}
                ]
                if self.custom_ids:
                    return                     # succès → on sort
            # ------------------------------------------------------------

            # sinon : on attend et on ré-essaye
            print("   → Aucun bouton U1-U4 visible pour l’instant.")

        # après max_retry tentatives : on laisse self.custom_ids vide
        print("⚠️  Boutons U1-U4 introuvables : on passe à l’article suivant.")
        self.custom_ids = []

    # 3) cliquer successivement sur U1-U4
    def choose_images(self, delay: float = 4.0):
        if not self.custom_ids:
            return     # plus de crash, on saute simplement

        url = "https://discord.com/api/v9/interactions"
        headers = {"Authorization": self.authorization,
                   "Content-Type": "application/json"}

        for cid in self.custom_ids:
            payload = {
                "type": 3,
                "guild_id": self.guild_id,
                "channel_id": self.channel_id,
                "message_id": self.message_id,
                "application_id": self.application_id,
                "session_id": "xxxxx",
                "data": {
                    "component_type": 2,
                    "custom_id": cid
                }
            }
            requests.post(url, headers=headers, json=payload)
            time.sleep(delay)     # ← pause de 4 secondes

    # 4) récupérer les 4 images upscalées
    def download_image(self, wait_sec: int = 60):
        print("⏳ Attente upscales (U1‑U4)…")
        time.sleep(wait_sec)

        headers = {"Authorization": self.authorization,
                   "Content-Type": "application/json"}
        r = requests.get(
            f"https://discord.com/api/v9/channels/{self.channel_id}/messages",
            headers=headers,
        )
        r.raise_for_status()
        self.image_urls = [
            msg["attachments"][0]["url"]
            for msg in r.json()[:4] if msg.get("attachments")
        ]

# ──────────────────────────────────────────
# SITEMAP → LIST OF URLS                     
# ──────────────────────────────────────────
def get_sitemap_links(sitemap_url: str) -> list[str]:
    """
    Return every <loc> URL found in a WordPress (or any) XML sitemap.
    If the user passes only a domain, we prepend https:// automatically.
    """
    try:
        if not sitemap_url.startswith(("http://", "https://")):
            sitemap_url = "https://" + sitemap_url

        resp = requests.get(sitemap_url, timeout=30)
        resp.raise_for_status()

        ns   = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        root = ET.fromstring(resp.content)
        return [loc.text for loc in root.findall(".//sm:loc", ns)]

    except (requests.RequestException, ET.ParseError) as e:
        print(f"[SITEMAP] {e}")
        return []


# --------- Category Map --------------------------------------------------
CATEGORY_MAP = {
    "Snacks": "snacks",
    "All Recipes": "all-recipes",
    "Breakfast": "breakfast",
    "Desserts": "desserts",
    "Dinner": "dinner",
    "Drinks": "drinks",
    "Lunch": "lunch"
}

CODE_FENCE_RE = re.compile(r"^```(?:html)?\s*|\s*```$", flags=re.I|re.M)

# --- Pinterest boards (add here) ---
PINTEREST_BOARDS = [
    "Air Fryer Dinners & Snacks",
    "30-Minute Weeknight Meals",
    "Brunch & Breakfast Bakes",
    "Desserts & Chaos Cakes",
    "Pickle Fix (Dill-icious Recipes)",
    "Rebel Floats & Fun Drinks",
    "Charcuterie & Party Boards",
    "One-Pot & Casserole Comforts",
    "Pasta & Pizza Night",
    "BBQ & Grilling Classics",
    "Healthy Salads & Veggie Sides",
    "Slow Cooker & Instant Pot Comforts",
    "Bread & Pastry Workshop",
    "Protein-Packed Lunch Prep",
    "Sauces, Dips & Seasonings",
    "Soups, Stews & Chowders",
    "Canning, Ferments & Pickles",
    "Kitchen Hacks & How-To Guides",
    "Holiday & Seasonal Recipes",
    "Budget-Friendly & 5-Ingredient Meals",
    "Kid-Friendly Snacks & Lunches",
]

def strip_code_fences(text: str) -> str:
    """Remove ```html ...``` or ```...``` fences anywhere in the text."""
    return CODE_FENCE_RE.sub("", text).strip()

def extract_seo_value(lines, label):
    """
    Return text after the label (case‑insensitive), stripping any bold/italics and numbers.
    Accepts formats like:
      **SEO Title:** Value
      SEO Title: Value
      1. SEO Title: Value
    """
    for line in lines:
        if label.lower() in line.lower():
            # remove enumeration like "1." or "- "
            line = re.sub(r"^\s*[0-9]+\.|^-", "", line).strip()
            # remove bold markers
            line = re.sub(r"\*\*", "", line)
            # split on first colon or dash
            parts = re.split(r":|–|-", line, maxsplit=1)
            return parts[1].strip() if len(parts) > 1 else line.strip()
    return ""
START_ROW = 2   # <— change 12 to whatever first row you want
for idx, row in enumerate(values[START_ROW-1:], start=START_ROW):
    try:
        img_url, original_recipe = row[:2]

        # 1) Rewrite recipe
        rewrite_prompt = (
            "Rewrite in English language the following food recipe in a clean and professional format. "
            "Only include title, ingredients, and instructions. Do not add commentary.\n\n"
            + original_recipe
        )
        new_recipe_raw = generate_with_retry(rewrite_prompt, "Rewritten recipe", max_tries=3, min_len=20)
        time.sleep(5)
        new_recipe = new_recipe_raw.replace("*", "").replace("#", "").strip()
        title = next((l for l in new_recipe.splitlines() if l.strip()), "Untitled")
        recipe_name = title.strip()
        
       #  2) Midjourney generation
        mj_prompt = f"/imagine prompt: {img_url} Amateur photo from Reddit. The photo was taken by an amateur using her phone camera. RECIPE NAME: {title} Recipe --style raw --stylize 30 --iw 3 --v 6.1"
        mj = MidjourneyApi(
            mj_prompt,
            "936929561302675458",
            "1409256842495922158",
            "1409256843506614346",
            "12378764154715546233",
            "938956540159881230",
            "ODA4MzU0MzI4MDM2MjQ1NTA1.GKTXhZ.2Tq-c2-C90v58LBfChxTNRB0GpBtwa4kQgcOTM"
        )
        for _ in range(1):                      # repeat twice
            mj.send_message()        # 1) /imagine
            mj.get_message()         # 2) récupérer le msg + IDs U1‑U4
            mj.choose_images()       # 3) cliquer sur U1, U2, U3, U4
            mj.download_image()      # 4) récupérer les images upscalées
            full_image_block = img_url + "\n" + "\n".join(mj.image_urls)
            time.sleep(5)                       # 4) short pause (avoid Discord spam)
        # 3) Article generation
        # --- INTERNAL LINKS --------------------------------------------------
        domain = "https://www.winsomerecipes.com"                      # ← change to actual domain
        sitemap = f"{domain}/post-sitemap.xml"
        internal_links = get_sitemap_links(sitemap)
        # ---------------------------------------------------------------------
        art_prompt = f"""You are a professional americain recipe blogger. Your goal is to write a long, SEO-optimized blog article based on the recipe I will provide in english language.

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

<h2>Why You’ll Love {recipe_name}</h2>
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
https://www.pinterest.com/winsomerecipes/

Now write the full HTML article using the following recipe:
{new_recipe}"""
        article_raw = generate_with_retry(art_prompt, "Article HTML", max_tries=3, min_len=100)
        time.sleep(20)
        article = strip_code_fences(article_raw)
        article = clean_stars(article)

        # 4) SEO extraction (each element generated separately)
        # --- SEO Title ---
        seo_title_prompt = f"""
You are an SEO expert for a US food blog.

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
{article}
"""
        seo_title_raw = generate_with_retry(seo_title_prompt, "SEO title", max_tries=3, min_len=5)
        seo_title = strip_label_prefix(seo_title_raw)
        seo_title = format_seo_title(seo_title)

        # --- Meta Description ---
        meta_prompt = f"""
You are an SEO expert.

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
{article}
"""
        meta_raw = generate_with_retry(meta_prompt, "Meta description", max_tries=3, min_len=10)
        meta_raw = strip_label_prefix(meta_raw)
        meta_description = normalize_meta_description(meta_raw, max_len=140)

        # --- URL Slug ---
        slug_prompt = f"""
Create a short URL slug for this article.

Rules:
- Lowercase only.
- Words separated by hyphens.
- No stopwords if possible (like 'and', 'the', 'with').
- No domain, no path, only the slug.
- Example: garlic-butter-chicken-pasta

Return ONLY the slug, nothing else.

Article:
{article}
"""
        slug_raw = generate_with_retry(slug_prompt, "URL slug", max_tries=3, min_len=3)
        slug = strip_label_prefix(slug_raw)
        slug = slug.lower().strip().replace(" ", "-")

        # --- Focus Keyphrase ---
        keyphrase_prompt = f"""
Create a single focus keyphrase for this article.

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
{article}
"""
        keyphrase_raw = generate_with_retry(keyphrase_prompt, "Focus keyphrase", max_tries=3, min_len=3)
        keyphrase = strip_label_prefix(keyphrase_raw)
        time.sleep(10)
        
# ---------- Pinterest Pin elements ---------------------------------
# ---------- Pinterest Pin elements (each element separately) --------
        # Pin Title
        pin_title_prompt = f"""
You are a Pinterest food blogger with 10 years of success.

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
{article}
"""
        pin_title_raw = generate_with_retry(pin_title_prompt, "Pin title", max_tries=3, min_len=5)
        pin_title = strip_label_prefix(pin_title_raw)
        pin_title = smart_truncate(pin_title, 100)



        # Pin Description
        pin_description_prompt = f"""
You are a Pinterest food blogger with 10 years of success.

Write a Pin Description for this article.

Rules:
- Natural, conversational tone.
- 240–330 characters.
- Similar style to these examples:
  - This Chocolate Cupcake recipe is my go-to for birthday parties and bake sales, since they are perfectly moist and oh-so chocolatey. Top them with our chocolate frosting, and you have the ultimate chocolate lover’s cupcake!
  - Easy Croissant French Toast Casserole with fresh berries is the best crowd-pleasing breakfast recipe. Refrigerate overnight for easy serving.
  - Relive your favorite childhood mornings with this incredibly easy Fruity Pebbles Breakfast Bread! It's fast, fun, and packed with colorful cereal goodness. Perfect for breakfast, brunch, or a sweet treat anytime. Get ready for smiles!
- Return ONLY the description, nothing else.

DO NOT use this "—" in texts and titles etc...

Use ONLY standard ASCII English punctuation in texts and titles etc...
Allowed characters:
. , ? ! : ; ' " ( ) [ ] - /

Article:
{article}
"""
        pin_description_raw = generate_with_retry(pin_description_prompt, "Pin description", max_tries=3, min_len=50)
        pin_description_raw = strip_label_prefix(pin_description_raw)
        pin_description = normalize_pin_description(
            pin_description_raw,
            min_len=240,
            max_len=330
        )


        # Keywords
        pin_keywords_prompt = f"""
Create 5–8 Pinterest keywords for this article.

Rules:
- English.
- Comma-separated.
- No hashtags.
- No duplicates.
- Example: garlic butter chicken, creamy pasta, weeknight dinner

Return ONLY the comma-separated list.

Article:
{article}
"""
        keywords_raw = generate_with_retry(pin_keywords_prompt, "Pin keywords", max_tries=3, min_len=10)
        keywords = strip_label_prefix(keywords_raw)


        # Board
        pin_board_prompt = f"""
Choose the single BEST Pinterest board from this list for the article below:

{", ".join(PINTEREST_BOARDS)}

Rules:
- Return EXACTLY one board name.
- It must match one of the names above exactly.
- No extra words.

Article:
{article}
"""
        board_raw = generate_with_retry(pin_board_prompt, "Pin board", max_tries=3, min_len=3)
        board = strip_label_prefix(board_raw)


        time.sleep(10)

        # ---------- Category detection ---------------------------------
        cat_prompt = f"""
        Wähle die BESTPASSENDE Kategorie für den folgenden deutschen Artikel.
        Antworte nur mit dem Kategorienamen, der GENAU so in dieser Liste steht:
        {', '.join(CATEGORY_MAP.keys())}

        Artikel:
        {article}
        """
        category_name_raw = generate_with_retry(cat_prompt, "Category name", max_tries=3, min_len=3)
        category_name = category_name_raw.strip()
        time.sleep(5)

        # —— garde‑fou ——————————————————————————
        if category_name not in CATEGORY_MAP or not category_name:
            print(f"⚠️  Invalid category detected: '{category_name}'. Using fallback.")
            category_name = "All Recipes"

        # Slug associé
        category_slug = CATEGORY_MAP[category_name]

        # —— Valeur à inscrire dans la feuille ——————————
        category_cell = category_name

# ---------- Tag generation ------------------------------------
        tags_prompt = f"""
        (The tags should be in English) Gib 3–5 relevante Tags (Komma-getrennt, nur Kleinbuchstaben) für diesen englischsprachigen Rezept-Artikel zurück. Keine Hashtags, keine Wiederholungen.

        Artikel:
        {article}
        """
        tags = generate_with_retry(tags_prompt, "Tags", max_tries=3, min_len=5).strip()
# ---------- Recipe-card JSON -----------------------------------
        recipe_prompt_template = """
        You are an expert recipe-card generator.
        Parse the following english food article and return ONLY a JSON object (no backticks, no markdown) that follows THIS schema exactly:

        {
   
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
  "tags": {
    "course": ["Dinner", "Main Course"],
    "cuisine": ["American", "Italian-Inspired"],
    "keyword": ["Garlic Butter Chicken", "Creamy Pasta", "Parmesan"],
    "difficulty": []
  },
  "equipment": [
    { "name": "Large Skillet" },
    { "name": "Large Pot" },
    { "name": "Tongs or Spatula" }
  ],
  "ingredients_flat": [
    {
      "name": "For the Garlic Butter Chicken Bites",
      "type": "group"
    },
    {
      "amount": "1",
      "unit": "lb",
      "name": "boneless chicken breasts",
      "notes": "cut into bite-sized pieces",
      "converted": {
        "2": { "amount": "450", "unit": "g" }
      },
      "type": "ingredient"
    },
    {
      "amount": "2",
      "unit": "tbsp",
      "name": "olive oil",
      "notes": "",
      "converted": {
        "2": { "amount": "30", "unit": "ml" }
      },
      "type": "ingredient"
    },
    {
      "amount": "3",
      "unit": "tbsp",
      "name": "unsalted butter",
      "notes": "",
      "converted": {
        "2": { "amount": "45", "unit": "g" }
      },
      "type": "ingredient"
    },
    {
      "amount": "3",
      "unit": "cloves",
      "name": "garlic",
      "notes": "minced",
      "converted": {
        "2": { "amount": "3", "unit": "cloves" }
      },
      "type": "ingredient"
    },
    {
      "amount": "1",
      "unit": "tsp",
      "name": "paprika",
      "notes": "",
      "converted": {
        "2": { "amount": "1", "unit": "tsp" }
      },
      "type": "ingredient"
    },
    {
      "amount": "1/2",
      "unit": "tsp",
      "name": "Italian seasoning",
      "notes": "",
      "converted": {
        "2": { "amount": "0.5", "unit": "tsp" }
      },
      "type": "ingredient"
    },
    {
      "amount": "1/2",
      "unit": "tsp",
      "name": "salt",
      "notes": "",
      "converted": {
        "2": { "amount": "0.5", "unit": "tsp" }
      },
      "type": "ingredient"
    },
    {
      "amount": "1/4",
      "unit": "tsp",
      "name": "black pepper",
      "notes": "",
      "converted": {
        "2": { "amount": "0.25", "unit": "tsp" }
      },
      "type": "ingredient"
    },
    {
      "name": "For the Creamy Parmesan Pasta",
      "type": "group"
    },
    {
      "amount": "12",
      "unit": "oz",
      "name": "fettuccine",
      "notes": "or linguine",
      "converted": {
        "2": { "amount": "340", "unit": "g" }
      },
      "type": "ingredient"
    },
    {
      "amount": "2",
      "unit": "tbsp",
      "name": "unsalted butter",
      "notes": "",
      "converted": {
        "2": { "amount": "30", "unit": "g" }
      },
      "type": "ingredient"
    },
    {
      "amount": "2",
      "unit": "cloves",
      "name": "garlic",
      "notes": "minced",
      "converted": {
        "2": { "amount": "2", "unit": "cloves" }
      },
      "type": "ingredient"
    },
    {
      "amount": "1.5",
      "unit": "cups",
      "name": "heavy cream",
      "notes": "",
      "converted": {
        "2": { "amount": "360", "unit": "ml" }
      },
      "type": "ingredient"
    },
    {
      "amount": "1",
      "unit": "cup",
      "name": "Parmesan cheese",
      "notes": "grated",
      "converted": {
        "2": { "amount": "100", "unit": "g" }
      },
      "type": "ingredient"
    },
    {
      "amount": "1/2",
      "unit": "tsp",
      "name": "Italian seasoning",
      "notes": "",
      "converted": {
        "2": { "amount": "0.5", "unit": "tsp" }
      },
      "type": "ingredient"
    },
    {
      "amount": "1/4",
      "unit": "tsp",
      "name": "red pepper flakes",
      "notes": "optional",
      "converted": {
        "2": { "amount": "0.25", "unit": "tsp" }
      },
      "type": "ingredient"
    },
    {
      "amount": "",
      "unit": "",
      "name": "salt and black pepper",
      "notes": "to taste",
      "converted": {
        "2": { "amount": "", "unit": "" }
      },
      "type": "ingredient"
    },
    {
      "amount": "2",
      "unit": "tbsp",
      "name": "fresh parsley",
      "notes": "chopped, for garnish",
      "converted": {
        "2": { "amount": "2", "unit": "tbsp" }
      },
      "type": "ingredient"
    }
  ],
  "instructions_flat": [
    {
      "text": "<p><strong>Step 1:</strong> Cook pasta in a large pot of salted water until al dente. Reserve ½ cup of pasta water. Drain and set aside.</p>",
      "type": "instruction",
      "image_url": ""
    },
    {
      "text": "<p><strong>Step 2:</strong> In a skillet, heat olive oil over medium-high. Season chicken with paprika, Italian seasoning, salt, and pepper. Sear for 3–4 minutes per side until golden and cooked through. Remove and set aside.</p>",
      "type": "instruction",
      "image_url": ""
    },
    {
      "text": "<p><strong>Step 3:</strong> In the same skillet, melt butter and add minced garlic. Sauté for 1 minute. Return chicken to the pan and toss in garlic butter. Remove from heat and set aside.</p>",
      "type": "instruction",
      "image_url": ""
    },
    {
      "text": "<p><strong>Step 4:</strong> In a clean skillet, melt 2 tbsp butter over medium heat. Add garlic and cook for 1 minute. Pour in heavy cream, then simmer for 2–3 minutes. Stir in Parmesan, Italian seasoning, and red pepper flakes. Season to taste.</p>",
      "type": "instruction",
      "image_url": ""
    },
    {
      "text": "<p><strong>Step 5:</strong> Add cooked pasta to the sauce and toss until evenly coated. Thin with reserved pasta water if needed.</p>",
      "type": "instruction",
      "image_url": ""
    },
    {
      "text": "<p><strong>Step 6:</strong> Plate pasta, top with garlic butter chicken bites, and garnish with fresh parsley and extra Parmesan. Serve immediately.</p>",
      "type": "instruction",
      "image_url": ""
    }
  ],
  "video_embed": "",
  "notes": "<p>Make it lighter by swapping heavy cream with half-and-half. Add steamed broccoli or spinach for extra veggies. Store leftovers in the fridge up to 3 days.</p>",
  "nutrition": {
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
    "iron": 2.1
  },
  "custom_fields": {
    "inspiration": "A restaurant-style pasta dish made easily at home with everyday ingredients. Garlic, cream, and Parmesan elevate this comfort classic."
  },
  "ingredient_links_type": "global"
}

        Rules:
        • Fill every blank with info from the article.
        • Times are integers in minutes.
        • Leave a field empty (or 0) if info is missing.
        • Do NOT wrap the JSON in backticks or markdown.

        ARTICLE:
        {article}
        """
        # --- Fill the JSON recipe card ---------------------------------
        card_prompt = recipe_prompt_template.replace("{article}", article)
        time.sleep(10)
        UNWANTED = ["```json", "```"]          # tokens to remove

        recipe_json = ""
        max_json_tries = 3
        for attempt in range(1, max_json_tries + 1):
            raw_json = call_openai(card_prompt).strip()
            for token in UNWANTED:
                raw_json = raw_json.replace(token, "")
            try:
                json.loads(raw_json)   # will raise if invalid
                recipe_json = raw_json
                if attempt > 1:
                    print(f"Recipe JSON succeeded on attempt {attempt}.")
                break
            except json.JSONDecodeError as e:
                print(f"⚠️  Invalid recipe JSON on attempt {attempt}/{max_json_tries}: {e}")
                recipe_json = raw_json
                time.sleep(5)

        # 5) Update Google Sheet
        update = {
    "valueInputOption": "RAW",
    "data": [
        {"range": f"Sheet1!A{idx}", "values": [[full_image_block]]},
        {"range": f"Sheet1!B{idx}", "values": [[new_recipe]]},
        {"range": f"Sheet1!C{idx}", "values": [[title]]},
        {"range": f"Sheet1!D{idx}", "values": [[seo_title]]},
        {"range": f"Sheet1!E{idx}", "values": [[meta_description]]},
        {"range": f"Sheet1!F{idx}", "values": [[category_cell]]},
        {"range": f"Sheet1!G{idx}", "values": [[article]]},
        {"range": f"Sheet1!H{idx}", "values": [[slug]]},
        {"range": f"Sheet1!I{idx}", "values": [[keyphrase]]},
        {"range": f"Sheet1!J{idx}", "values": [[tags]]},
        {"range": f"Sheet1!K{idx}", "values": [[pin_title]]},
        {"range": f"Sheet1!L{idx}", "values": [[pin_description]]},
        {"range": f"Sheet1!M{idx}", "values": [[keywords]]},
        {"range": f"Sheet1!N{idx}", "values": [[board]]},
        {"range": f"Sheet1!O{idx}", "values": [[recipe_json]]},
    ]
}
        sheet.values().batchUpdate(spreadsheetId=SPREADSHEET_ID, body=update).execute()
        print(f"Row {idx} ✓ updated")

    except Exception as err:
        print(f"Row {idx} ✗ {err}")
        traceback.print_exc()
        continue

    # 6) After all rows are processed, copy data to the other two sheets
    try:
        # --- download everything from Sheet1 columns A–O -------------
        sheet1_data = sheet.values().get(
            spreadsheetId=SPREADSHEET_ID,
            range="Sheet1!A:O"
        ).execute().get("values", [])

        if not sheet1_data or len(sheet1_data) <= 1:
            print("Nothing to copy – Sheet1 has only the header (or is empty).")
            quit()

        # -----------------------------------------------------------------
        # ⟵⟵⟵ 1)   ON IGNORE LA PREMIÈRE LIGNE   ---------------------------
        data_rows = sheet1_data[1:]      # saute l’en‑tête (ligne 1)
        # -----------------------------------------------------------------

        # > Wordpress : on ajoute 2 colonnes (A et B) contenant la col. A de Sheet1,
        #   puis on décale l’ancienne sélection vers la droite.
        wordpress_rows = []
        for row in data_rows:
            a_value = row[0] if len(row) > 0 else ""   # Sheet1 col A (multi-line links)
            link_a, link_b = pick_two_alt_links(a_value)
            wordpress_rows.append([
                link_a,                                # A: random link from link2..5
                link_b,                                # B: another random link from link2..5
                row[3] if len(row) > 3 else "",        # C: seo_title
                row[4] if len(row) > 4 else "",        # D: meta_description
                row[5] if len(row) > 5 else "",        # E: category_cell
                row[6] if len(row) > 6 else "",        # F: article
                row[7] if len(row) > 7 else "",        # G: slug
                row[8] if len(row) > 8 else "",        # H: keyphrase
                row[9] if len(row) > 9 else "",        # I: tags
                row[14] if len(row) > 14 else "",      # J: recipe_json (from column O)
            ])

        # > Pinterest : même logique, sans ligne 1
        pinterest_rows = []
        for row in data_rows:
            pr = [""] * 8
            if 10 < len(row): pr[0] = row[10]   # A <- K
            if 13 < len(row): pr[2] = row[13]   # C <- N
            if 11 < len(row): pr[4] = row[11]   # E <- L
            if 12 < len(row): pr[7] = row[12]   # H <- M
            pinterest_rows.append(pr)

        # > Pinterest Bulk Canva : 3 colonnes
        pinterest_bulk_rows = []
        for row in data_rows:
            a_value = row[0] if len(row) > 0 else ""    # Sheet1 col A (multi-line links)
            k_value = row[10] if len(row) > 10 else ""  # Sheet1 col K (pin title)
            link_a, link_b = pick_two_alt_links(a_value)
            pinterest_bulk_rows.append([link_a, link_b, k_value])

        # -----------------------------------------------------------------
        # ⟵⟵⟵ 2)   COLLER À PARTIR DE LA LIGNE 2 DANS LES FEUILLES CIBLES
        copy_body = {
            "valueInputOption": "RAW",
            "data": [
                {"range": "wordpress!A2",        "values": wordpress_rows},
                {"range": "pinterest!A2",        "values": pinterest_rows},
                {"range": "pinterest_bulk_cnv!A2", "values": pinterest_bulk_rows}
            ]
        }
        safe_batch_update(sheet, copy_body)

        # -----------------------------------------------------------------

        sheet.values().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body=copy_body
        ).execute()
        print("✓ Data copied to 'wordpress' and 'pinterest' (header skipped).")

    except Exception as copy_err:
        print("✗ Copy‑step error:", copy_err)
        traceback.print_exc()
