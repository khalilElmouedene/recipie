from __future__ import annotations
import json
import re
import time
from typing import Callable
from openai import OpenAI

from .prompts import get_prompt


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


def generate_article(recipe_title: str, full_recipe: str, external_links: str, internal_links: list[str], api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    tpl = get_prompt(prompts or {}, "article")
    prompt = tpl.format(recipe_title=recipe_title, full_recipe=full_recipe, external_links=external_links or "", internal_links=", ".join(internal_links) if internal_links else "")
    result = generate_with_openai(prompt, api_key, log=log)
    result = re.sub(r'```html\s*', '', result)
    result = re.sub(r'\s*```', '', result)
    return result


def generate_full_recipe(recipe_title: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    p = prompts or {}
    system = get_prompt(p, "full_recipe_system")
    user_tpl = get_prompt(p, "full_recipe_user")
    user_content = user_tpl.format(recipe_title=recipe_title)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        temperature=0.7,
        max_tokens=2000,
    )
    result = response.choices[0].message.content.strip()
    return re.sub(r'[*#]+', '', result)


def generate_recipe_json(recipe_title: str, full_recipe: str, author: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    p = prompts or {}
    system = get_prompt(p, "recipe_json_system")
    user_tpl = get_prompt(p, "recipe_json_user")
    user_content = user_tpl.format(full_recipe=full_recipe)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
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


def generate_meta_description(recipe_title: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    p = prompts or {}
    system = get_prompt(p, "meta_description_system")
    user_tpl = get_prompt(p, "meta_description_user")
    user_content = user_tpl.format(recipe_title=recipe_title)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        temperature=0.7,
        max_tokens=100,
    )
    result = response.choices[0].message.content.strip()
    return re.sub(r'[*#"]', '', result)


def generate_category(recipe_title: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    p = prompts or {}
    system = get_prompt(p, "category_system")
    user_tpl = get_prompt(p, "category_user")
    user_content = user_tpl.format(recipe_title=recipe_title)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        temperature=0.3,
        max_tokens=20,
    )
    return response.choices[0].message.content.strip()


def generate_pinterest_pin_title(recipe_title: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    p = prompts or {}
    system = get_prompt(p, "pinterest_title_system")
    user_tpl = get_prompt(p, "pinterest_title_user")
    user_content = user_tpl.format(recipe_title=recipe_title)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        temperature=0.7,
        max_tokens=100,
    )
    return re.sub(r'[*#"]', '', response.choices[0].message.content.strip())


def generate_pinterest_pin_description(recipe_title: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    p = prompts or {}
    system = get_prompt(p, "pinterest_description_system")
    user_tpl = get_prompt(p, "pinterest_description_user")
    user_content = user_tpl.format(recipe_title=recipe_title)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ],
        temperature=0.7,
        max_tokens=200,
    )
    return re.sub(r'[*#"]', '', response.choices[0].message.content.strip())


def generate_pinterest_pin_tags(recipe_title: str, api_key: str, prompts: dict[str, str] | None = None, log: Callable[[str], None] | None = None) -> str:
    client = _get_client(api_key)
    p = prompts or {}
    system = get_prompt(p, "pinterest_tags_system")
    user_tpl = get_prompt(p, "pinterest_tags_user")
    user_content = user_tpl.format(recipe_title=recipe_title)
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
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
