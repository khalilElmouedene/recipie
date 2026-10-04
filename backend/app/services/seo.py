"""Shared SEO checks for generated text and the final publish payload."""
from __future__ import annotations

import re
import unicodedata
from html import unescape

from bs4 import BeautifulSoup


def require_generated_text(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("AI returned empty content")
    value = value.strip()
    if re.match(r"^(?:error|failed)\s*:", value, re.I):
        raise ValueError("AI generation failed; error text cannot be saved as content")
    return value


def plain_text(value: str) -> str:
    return " ".join(BeautifulSoup(unescape(value), "html.parser").get_text(" ", strip=True).split())


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", unescape(value)).casefold()
    value = re.sub(r"[\u200b-\u200d\u2060\ufeff\u00ad]", "", value)
    return " ".join(value.split())


def contains_keyword(value: str, keyword: str) -> bool:
    return bool(keyword) and bool(re.search(r"(?<!\w)" + re.escape(normalize_text(keyword)) + r"(?!\w)", normalize_text(value)))


def clean_focus_keyword(value: str) -> str:
    if isinstance(value, str) and ("\n" in value.strip() or "\r" in value.strip()):
        raise ValueError("Focus keyword must be one search phrase, not a list")
    value = plain_text(require_generated_text(value)).strip('"\'`* ')
    value = re.sub(r"^(?:focus keyword|focus keyphrase|keyword|keyphrase)\s*:\s*", "", value, flags=re.I)
    value = normalize_text(value)
    if not value or len(value) > 100 or any(char in value for char in ",;\n"):
        raise ValueError("Focus keyword must be one search phrase of at most 100 characters")
    return value


def article_issues(article: str, keyword: str) -> list[str]:
    require_generated_text(article)
    soup = BeautifulSoup(article, "html.parser")
    for element in soup(["script", "style"]):
        element.decompose()
    body = BeautifulSoup(str(soup), "html.parser")
    for heading in body.find_all("h1"):
        heading.decompose()  # The publisher removes the article H1.
    text = body.get_text(" ", strip=True)
    issues = []
    if len(re.findall(r"\b\w+(?:[-'’]\w+)*\b", text)) < 600:
        issues.append("Write at least 600 words of useful visible body text, excluding the H1. Add recipe-specific guidance rather than filler.")
    h1 = soup.find("h1")
    first_p = soup.find("p")
    if not h1 or not contains_keyword(h1.get_text(" "), keyword):
        issues.append("Use the exact primary search phrase in one article H1.")
    if not first_p or not contains_keyword(first_p.get_text(" "), keyword):
        issues.append("Use the exact primary search phrase naturally in the first paragraph.")
    if not any(contains_keyword(h.get_text(" "), keyword) for h in soup.find_all(["h2", "h3"])):
        issues.append("Use the exact primary search phrase in one relevant H2 or H3.")
    return issues


def metadata_issues(value: str, keyword: str, *, title: bool = False) -> list[str]:
    require_generated_text(value)
    issues = []
    if not contains_keyword(value, keyword):
        issues.append("Include the exact primary search phrase naturally.")
    limit = 70 if title else 160
    if len(value) > limit:
        issues.append(f"Use at most {limit} characters without cutting a word or the search phrase.")
    return issues


def validate_recipe_card(data: dict) -> dict:
    if not isinstance(data, dict) or not isinstance(data.get("name"), str) or not data["name"].strip():
        raise ValueError("Recipe card needs a name")
    for flat_key, grouped_key, item_type, required_key in (
        ("ingredients_flat", "ingredients", "ingredient", "name"),
        ("instructions_flat", "instructions", "instruction", "text"),
    ):
        flat = data.get(flat_key) or []
        groups = data.get(grouped_key) or []
        if not isinstance(flat, list) or not isinstance(groups, list):
            raise ValueError(f"Recipe {grouped_key} must be a list")
        items = [item for item in flat if isinstance(item, dict) and item.get("type") == item_type]
        for group in groups:
            if isinstance(group, dict) and isinstance(group.get(grouped_key), list):
                items.extend(group[grouped_key])
        if not items or any(not isinstance(item, dict) or not isinstance(item.get(required_key), str)
                            or not plain_text(item[required_key]) for item in items):
            raise ValueError(f"Recipe card needs nonempty {grouped_key}")
    if "nutrition" in data and not isinstance(data["nutrition"], dict):
        raise ValueError("Recipe nutrition must be an object")
    return data
