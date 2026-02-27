from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from typing import Any

import openpyxl
from openpyxl.styles import (
    Alignment, Font, PatternFill, Border, Side,
)
from openpyxl.utils import get_column_letter

# ── Column definitions (matches V1 Project 1.xlsx exactly) ──────────────────

COLUMNS = [
    "Featured Image",
    "Articles",
    "Recipe JSON",
    "Category",
    "Publish Date",
    "Focus Keyword",
    "Meta description",
    "full recipe",
    "Pin Title",
    "link article",
    "Pin Description",
    "Tags",
    "internal link",
    "external link",
]

# Column widths (approximate)
COL_WIDTHS = [60, 60, 60, 18, 22, 40, 60, 60, 60, 50, 60, 40, 45, 40]

_HEADER_FILL = PatternFill("solid", fgColor="2D5016")
_HEADER_FONT = Font(bold=True, color="FFFFFF", size=10)
_ALT_FILL    = PatternFill("solid", fgColor="F5F0E8")
_BORDER_SIDE = Side(style="thin", color="CCCCCC")
_CELL_BORDER = Border(
    left=_BORDER_SIDE, right=_BORDER_SIDE,
    top=_BORDER_SIDE,  bottom=_BORDER_SIDE,
)
_WRAP        = Alignment(wrap_text=True, vertical="top")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _first_image(recipe: Any) -> str:
    """Use first generated image URL, or fallback to original image_url."""
    if recipe.generated_images:
        try:
            imgs = json.loads(recipe.generated_images)
            if imgs and isinstance(imgs, list) and imgs[0]:
                return imgs[0]
        except Exception:
            pass
    return recipe.image_url or ""


def _publish_date(recipe: Any) -> str:
    dt = recipe.created_at
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%Y/%m/%d %H:%M")


def _sitemap_url(domain: str) -> str:
    d = domain.replace("https://", "").replace("http://", "").rstrip("/")
    return f"https://{d}/sitemap_index.xml"


def _pin_title(recipe: Any) -> str:
    """Derive a Pin Title from focus_keyword or first line of recipe_text."""
    if recipe.focus_keyword:
        return recipe.focus_keyword.strip()
    if recipe.recipe_text:
        return recipe.recipe_text.split("\n")[0].strip()
    return ""


def _recipe_row(recipe: Any, sitemap_url: str) -> list[str]:
    return [
        _first_image(recipe),                    # Featured Image
        recipe.generated_article or "",          # Articles
        recipe.generated_json or "",             # Recipe JSON
        recipe.category or "",                   # Category
        _publish_date(recipe),                   # Publish Date
        recipe.focus_keyword or "",              # Focus Keyword
        recipe.meta_description or "",           # Meta description
        recipe.generated_full_recipe or "",      # full recipe
        _pin_title(recipe),                      # Pin Title
        recipe.wp_permalink or "",               # link article
        recipe.meta_description or "",           # Pin Description
        "",                                      # Tags (not generated yet)
        sitemap_url,                             # internal link
        "",                                      # external link (Pinterest)
    ]


# ── Sheet builder ─────────────────────────────────────────────────────────────

def _write_sheet(ws, site: Any, recipes: list[Any]) -> None:
    # Header row
    for col_idx, col_name in enumerate(COLUMNS, start=1):
        cell = ws.cell(row=1, column=col_idx, value=col_name)
        cell.fill   = _HEADER_FILL
        cell.font   = _HEADER_FONT
        cell.border = _CELL_BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    ws.row_dimensions[1].height = 30

    # Set column widths
    for col_idx, width in enumerate(COL_WIDTHS, start=1):
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    sitemap = _sitemap_url(site.domain)

    # Data rows
    for row_idx, recipe in enumerate(recipes, start=2):
        row_data = _recipe_row(recipe, sitemap)
        fill = _ALT_FILL if row_idx % 2 == 0 else None
        for col_idx, value in enumerate(row_data, start=1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.border    = _CELL_BORDER
            cell.alignment = _WRAP
            if fill:
                cell.fill = fill

    # Freeze header row
    ws.freeze_panes = "A2"


# ── Public API ────────────────────────────────────────────────────────────────

def build_project_excel(
    project_name: str,
    sites_with_recipes: list[tuple[Any, list[Any]]],
) -> bytes:
    """
    Build an xlsx workbook with one sheet per site.
    sites_with_recipes: list of (Site, [Recipe, ...])
    Returns bytes ready to stream.
    """
    wb = openpyxl.Workbook()
    wb.remove(wb.active)  # remove default empty sheet

    for site, recipes in sites_with_recipes:
        domain = site.domain.replace("https://", "").replace("http://", "").rstrip("/")
        ws = wb.create_sheet(title=domain[:31])  # Excel max 31 chars
        _write_sheet(ws, site, recipes)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()


def build_site_excel(site: Any, recipes: list[Any]) -> bytes:
    """Build an xlsx workbook for a single site."""
    return build_project_excel(site.domain, [(site, recipes)])
