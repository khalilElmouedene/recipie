from __future__ import annotations
import json
import re
import time
from typing import Callable
from openai import OpenAI

from .prompts import get_prompt
from .seo import article_issues, metadata_issues, plain_text, require_generated_text, validate_recipe_card


def _get_client(api_key: str) -> OpenAI:
    return OpenAI(api_key=api_key)


def _response_text(response) -> str:
    choice = response.choices[0]
    if choice.finish_reason in ("length", "content_filter"):
        raise ValueError(f"AI response is incomplete ({choice.finish_reason})")
    return require_generated_text(choice.message.content)


def _repair_seo_once(value: str, issues: list[str], api_key: str, *, kind: str, keyword: str, log=None) -> str:
    if not issues:
        return value
    if log:
        log(f"Repairing {kind}: {' '.join(issues)}")
    return generate_with_openai(
        f"Correct this {kind} while preserving its language and recipe facts. "
        f"The exact primary search phrase is: {keyword}\n"
        + "\n".join(issues)
        + f"\nReturn only the corrected {kind}, with no commentary or markdown fences.\n\n{value}",
        api_key, log=log,
    )


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
            return _response_text(response)
        except Exception as e:
            error_msg = str(e)
            _log(f"OpenAI error: {error_msg}")
            if attempt == max_retries - 1:
                raise RuntimeError("AI generation failed after all attempts") from e
            if "rate limit" in error_msg.lower():
                wait = 30 * (2 ** attempt)
                _log(f"Rate limited. Waiting {wait}s...")
                time.sleep(wait)
            elif attempt < max_retries - 1:
                wait = 10 * (attempt + 1)
                _log(f"Retrying in {wait}s...")
                time.sleep(wait)
    raise RuntimeError("AI generation failed without a completed response")


def generate_article(recipe_title: str, full_recipe: str, external_links: str, internal_links: list[str], api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None, site_domain: str = "", pinterest_url: str = "", focus_keyword: str = "") -> str:
    tpl = get_prompt(prompts or {}, "article")
    if internal_links:
        # Use up to 30 links — one per line so the AI can read them clearly.
        sample = internal_links[:30]
        links_list = "\n".join(sample)
        links_instruction = (
            "You MUST use 2-3 internal links from the list below.\n"
            "Rules:\n"
            "- Integrate 1-2 links naturally inside existing body paragraphs using rich anchor text.\n"
            "- Use 1-2 links in the Conclusion section in a sentence like: "
            "\"For more delicious recipes, check out [anchor text] or [anchor text] for treats you will love!\"\n"
            "- Use meaningful and descriptive anchor text (no 'click here').\n"
            "- Use ONLY URLs from this exact list — do not invent or modify any URL.\n\n"
            f"Available internal links:\n{links_list}"
        )
    else:
        links_instruction = (
            "No verified internal URLs are available. Omit internal links; never invent recipe URLs."
        )
    prompt = tpl.format(
        recipe_name=recipe_title,
        recipe_title=recipe_title,      # legacy DB compat
        new_recipe=full_recipe,
        full_recipe=full_recipe,        # legacy DB compat
        external_links=external_links or "",
        internal_links=links_instruction,
        pinterest_url=pinterest_url or "",
        focus_keyword=focus_keyword,
    )
    if focus_keyword:
        prompt += (f"\nPrimary search phrase: {focus_keyword}. Use this exact phrase naturally in the H1, "
                   "first paragraph, and one relevant H2/H3. Write 750-1000 useful body words. "
                   "Use the supplied recipe's language. Keep all ingredients, quantities and instructions consistent with that recipe. "
                   "Do not invent personal testing stories. Return clean HTML only.")
    result = generate_with_openai(prompt, api_key, log=log)
    result = re.sub(r'```html\s*', '', result)
    result = re.sub(r'\s*```', '', result)
    if focus_keyword:
        issues = article_issues(result, focus_keyword)
        result = _repair_seo_once(result, issues, api_key, kind="HTML article", keyword=focus_keyword, log=log)
        result = re.sub(r'```(?:html)?\s*|\s*```', '', result)
        remaining = article_issues(result, focus_keyword)
        if remaining:
            raise ValueError("Article failed SEO validation: " + " ".join(remaining))
    return require_generated_text(result)


def generate_full_recipe(recipe_title: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    tpl = get_prompt(prompts or {}, "full_recipe")
    prompt = tpl.format(original_recipe=recipe_title, recipe_title=recipe_title.splitlines()[0])
    prompt += "\nPreserve the supplied recipe's language, quantities, times and instructions. Do not invent testing claims."
    if recipe_title not in prompt:
        prompt += f"\nComplete source recipe:\n{recipe_title}"
    result = generate_with_openai(prompt, api_key, log=log)
    return re.sub(r'[*#]+', '', result)


def generate_recipe_json(recipe_title: str, article: str, author: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None, full_recipe: str = "") -> str:
    tpl = get_prompt(prompts or {}, "recipe_json")
    prompt = tpl.format(article=article, full_recipe=full_recipe or article)
    if full_recipe:
        prompt += f"\nUse this canonical recipe for quantities and instructions. Do not copy facts from examples. Leave unknown nutrition blank.\n{full_recipe}"
    model_response = generate_with_openai(prompt, api_key, log=log)
    clean_json = re.sub(r'```(?:json)?(.*?)```', r'\1', model_response, flags=re.DOTALL).strip()

    base_template = _get_wp_recipe_template(recipe_title, "")
    # recipe_title kept for base template fallback; article is used in the prompt
    base_template["author"]["name"] = author or ""

    try:
        recipe_data = json.loads(clean_json)
        validate_recipe_card(recipe_data)
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
    except (json.JSONDecodeError, ValueError, TypeError) as exc:
        raise ValueError("AI returned an invalid or incomplete recipe card") from exc

    return json.dumps(base_template, indent=2)


def generate_meta_description(article: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None, focus_keyword: str = "") -> str:
    tpl = get_prompt(prompts or {}, "meta_description")
    prompt = tpl.format(article=article, recipe_title=article, focus_keyword=focus_keyword)
    if focus_keyword:
        prompt += f"\nUse the article's language and include the exact phrase {focus_keyword}. Maximum 160 characters; plain text only."
    result = generate_with_openai(prompt, api_key, log=log)
    result = plain_text(require_generated_text(result)).strip('"\' ')
    if focus_keyword:
        result = plain_text(_repair_seo_once(result, metadata_issues(result, focus_keyword), api_key, kind="meta description", keyword=focus_keyword, log=log)).strip('"\' ')
        if metadata_issues(result, focus_keyword):
            raise ValueError("Meta description failed keyword/length validation")
    return result


def generate_category(article: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    tpl = get_prompt(prompts or {}, "category")
    prompt = tpl.format(article=article, recipe_title=article)
    client = _get_client(api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=20,
    )
    return _response_text(response)


def generate_seo_title(article: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None, focus_keyword: str = "") -> str:
    tpl = get_prompt(prompts or {}, "seo_title")
    prompt = tpl.format(article=article, recipe_title=article, focus_keyword=focus_keyword)
    if focus_keyword:
        prompt += f"\nUse the article's language. Include the exact phrase {focus_keyword} near the beginning. Maximum 70 characters; plain text only."
    client = _get_client(api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.5,
        max_tokens=80,
    )
    result = plain_text(_response_text(response)).strip('"\' ')
    if focus_keyword:
        result = plain_text(_repair_seo_once(result, metadata_issues(result, focus_keyword, title=True), api_key, kind="SEO title", keyword=focus_keyword, log=log)).strip('"\' ')
        if metadata_issues(result, focus_keyword, title=True):
            raise ValueError("SEO title failed keyword/length validation")
    return result


def generate_focus_keyword(article: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    tpl = get_prompt(prompts or {}, "focus_keyword")
    prompt = tpl.format(article=article, recipe_title=article)
    client = _get_client(api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=30,
    )
    return _response_text(response)


def generate_wp_tags(article: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    tpl = get_prompt(prompts or {}, "wp_tags")
    prompt = tpl.format(article=article, recipe_title=article)
    result = generate_with_openai(prompt, api_key, log=log)
    return re.sub(r'[*#"]', '', result)


def generate_pinterest_pin_title(article: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    tpl = get_prompt(prompts or {}, "pinterest_title")
    prompt = tpl.format(article=article, recipe_title=article)
    result = generate_with_openai(prompt, api_key, log=log)
    return re.sub(r'[*#"]', '', result)


def generate_pinterest_pin_description(article: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    tpl = get_prompt(prompts or {}, "pinterest_description")
    prompt = tpl.format(article=article, recipe_title=article)
    result = generate_with_openai(prompt, api_key, log=log)
    return re.sub(r'[*#"]', '', result)


def generate_pinterest_pin_tags(article: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    tpl = get_prompt(prompts or {}, "pinterest_tags")
    prompt = tpl.format(article=article, recipe_title=article)
    result = generate_with_openai(prompt, api_key, log=log)
    return re.sub(r'[*#"]', '', result)


def generate_pinterest_pin_board(article: str, boards_list: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    tpl = get_prompt(prompts or {}, "pinterest_board")
    prompt = tpl.format(article=article, boards_list=boards_list, recipe_title=article)
    client = _get_client(api_key)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=50,
    )
    return _response_text(response)


def _get_wp_recipe_template(title: str, summary: str) -> dict:
    return {
        "type": "wprm_recipe",
        "name": title,
        "summary": summary,
        "author": {"id": 1, "name": ""},
        "author_name": "",
        "author_display": "disabled",
        "author_link": "",
        "servings": 0,
        "servings_unit": "servings",
        "cost": "",
        "prep_time": 0,
        "cook_time": 0,
        "total_time": 0,
        "custom_time": 0,
        "custom_time_label": "",
        "rating": {"count": 0, "total": 0, "average": 0},
        "tags": {"course": [], "cuisine": [], "keyword": [], "difficulty": "easy"},
        "equipment": [],
        "ingredients_flat": [{"uid": "group_1", "name": "Main Ingredients", "type": "group"}],
        "instructions_flat": [{"uid": "group_1", "name": "Instructions", "type": "group"}],
        "ingredients": [],
        "instructions": [],
        "nutrition": {
            "calories": "", "carbohydrates": "", "protein": "", "fat": "",
            "saturated_fat": "", "cholesterol": "", "sodium": "", "potassium": "",
            "fiber": "", "sugar": "", "vitamin_a": "", "vitamin_c": "",
            "calcium": "", "iron": "",
        },
        "custom_fields": {},
        "notes": "",
    }
