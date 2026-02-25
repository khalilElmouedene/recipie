from __future__ import annotations

import base64
import json
import os
import textwrap
from io import BytesIO
from typing import Optional

import requests
from PIL import Image, ImageDraw, ImageFont, ImageFilter

PIN_WIDTH = 1000
PIN_HEIGHT = 1500

# ── Font Loading ─────────────────────────────────────────

_font_cache: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}

_REGULAR_PATHS = [
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]
_BOLD_PATHS = [
    r"C:\Windows\Fonts\arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def _find_font(bold: bool = False) -> Optional[str]:
    for p in (_BOLD_PATHS if bold else _REGULAR_PATHS):
        if os.path.exists(p):
            return p
    for p in _REGULAR_PATHS:
        if os.path.exists(p):
            return p
    return None


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    key = (size, bold)
    if key in _font_cache:
        return _font_cache[key]
    path = _find_font(bold)
    if path:
        try:
            f = ImageFont.truetype(path, size)
            _font_cache[key] = f
            return f
        except Exception:
            pass
    return ImageFont.load_default()


# ── Image Helpers ────────────────────────────────────────

def _download(url: str) -> Image.Image:
    resp = requests.get(url, timeout=20, stream=True)
    resp.raise_for_status()
    return Image.open(BytesIO(resp.content)).convert("RGBA")


def _fit_crop(img: Image.Image, w: int, h: int) -> Image.Image:
    ratio_img = img.width / img.height
    ratio_target = w / h
    if ratio_img > ratio_target:
        new_h = h
        new_w = int(h * ratio_img)
    else:
        new_w = w
        new_h = int(w / ratio_img)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    left = (new_w - w) // 2
    top = (new_h - h) // 2
    return img.crop((left, top, left + w, top + h))


def _round_corners(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width, img.height], radius=radius, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, mask=mask)
    return out


def _placeholder(w: int = 400, h: int = 400) -> Image.Image:
    img = Image.new("RGBA", (w, h), (200, 200, 200, 255))
    d = ImageDraw.Draw(img)
    d.line([(0, 0), (w, h)], fill=(160, 160, 160), width=2)
    d.line([(w, 0), (0, h)], fill=(160, 160, 160), width=2)
    return img


def _get_images(urls: list[str], count: int) -> list[Image.Image]:
    imgs: list[Image.Image] = []
    for url in urls[:count]:
        try:
            imgs.append(_download(url))
        except Exception:
            imgs.append(_placeholder())
    while len(imgs) < count:
        imgs.append(_placeholder())
    return imgs


# ── Text Drawing ─────────────────────────────────────────

def _wrap_draw(
    draw: ImageDraw.ImageDraw,
    text: str,
    x: int, y: int,
    max_w: int,
    font: ImageFont.FreeTypeFont,
    color: str | tuple,
    spacing: float = 1.4,
    align: str = "left",
    max_lines: int = 0,
) -> int:
    """Word-wrap and draw text. Returns Y after last line."""
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        test = f"{cur} {word}".strip()
        bw = font.getbbox(test)[2] - font.getbbox(test)[0]
        if bw <= max_w:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        if lines:
            lines[-1] = lines[-1][: max(0, len(lines[-1]) - 3)] + "..."

    bb = font.getbbox("Ayg")
    lh = int((bb[3] - bb[1]) * spacing)
    cy = y
    for line in lines:
        lw = font.getbbox(line)[2] - font.getbbox(line)[0]
        if align == "center":
            lx = x + (max_w - lw) // 2
        elif align == "right":
            lx = x + max_w - lw
        else:
            lx = x
        draw.text((lx, cy), line, fill=color, font=font)
        cy += lh
    return cy


# ── Template Renderers ───────────────────────────────────

def _render_recipe_card(
    images: list[Image.Image], title: str, ingredients: str, website: str,
) -> Image.Image:
    canvas = Image.new("RGBA", (PIN_WIDTH, PIN_HEIGHT), (245, 240, 232, 255))
    draw = ImageDraw.Draw(canvas)

    # Green header
    draw.rectangle([0, 0, PIN_WIDTH, 180], fill=(45, 80, 22))
    _wrap_draw(draw, title.upper(), 50, 35, PIN_WIDTH - 100,
               _font(46, True), "#ffffff", align="center", max_lines=3)

    # Two images
    iw, ih = 440, 480
    y0 = 210
    img1 = _round_corners(_fit_crop(images[0], iw, ih), 16)
    canvas.paste(img1, (50, y0), img1)
    if len(images) >= 2:
        img2 = _round_corners(_fit_crop(images[1], iw, ih), 16)
        canvas.paste(img2, (510, y0), img2)

    # Separator
    sep = y0 + ih + 30
    draw.rectangle([50, sep, PIN_WIDTH - 50, sep + 3], fill=(45, 80, 22))

    # Ingredients
    draw.text((50, sep + 20), "INGREDIENTS", fill=(45, 80, 22), font=_font(28, True))
    iy = sep + 60
    body = _font(22)
    for line in (ingredients or "").strip().split("\n")[:12]:
        line = line.strip()
        if not line:
            continue
        if not line.startswith(("\u2022", "-", "*")):
            line = f"\u2022  {line}"
        draw.text((60, iy), line, fill=(60, 60, 60), font=body)
        iy += 34

    # Footer
    draw.rectangle([0, PIN_HEIGHT - 70, PIN_WIDTH, PIN_HEIGHT], fill=(45, 80, 22))
    if website:
        _wrap_draw(draw, website, 50, PIN_HEIGHT - 52, PIN_WIDTH - 100,
                   _font(22), "#ffffff", align="center")
    return canvas


def _render_elegant(
    images: list[Image.Image], title: str, ingredients: str, website: str,
) -> Image.Image:
    canvas = Image.new("RGBA", (PIN_WIDTH, PIN_HEIGHT), (0, 0, 0, 255))

    bg = _fit_crop(images[0], PIN_WIDTH, PIN_HEIGHT)
    canvas.paste(bg, (0, 0))

    # Gradient overlay from bottom
    overlay = Image.new("RGBA", (PIN_WIDTH, PIN_HEIGHT), (0, 0, 0, 0))
    gd = ImageDraw.Draw(overlay)
    gh = 750
    for y in range(gh):
        a = int(230 * (y / gh) ** 1.6)
        gd.line([(0, PIN_HEIGHT - gh + y), (PIN_WIDTH - 1, PIN_HEIGHT - gh + y)],
                fill=(0, 0, 0, a))
    canvas = Image.alpha_composite(canvas, overlay)

    # Small inset
    if len(images) >= 2:
        inset = _round_corners(_fit_crop(images[1], 200, 200), 12)
        border = Image.new("RGBA", (208, 208), (255, 255, 255, 180))
        border.paste(inset, (4, 4), inset)
        canvas.paste(border, (PIN_WIDTH - 240, 30), border)

    draw = ImageDraw.Draw(canvas)
    _wrap_draw(draw, title, 60, PIN_HEIGHT - 320, PIN_WIDTH - 120,
               _font(54, True), "#ffffff", max_lines=3)
    draw.rectangle([60, PIN_HEIGHT - 140, 260, PIN_HEIGHT - 136], fill=(255, 180, 50))
    if website:
        draw.text((60, PIN_HEIGHT - 110), website, fill=(200, 200, 200), font=_font(22))
    return canvas


def _render_modern_split(
    images: list[Image.Image], title: str, ingredients: str, website: str,
) -> Image.Image:
    canvas = Image.new("RGBA", (PIN_WIDTH, PIN_HEIGHT), (255, 255, 255, 255))

    ih = 780
    photo = _fit_crop(images[0], PIN_WIDTH, ih)
    canvas.paste(photo, (0, 0))

    draw = ImageDraw.Draw(canvas)
    accent = (220, 90, 50)
    draw.rectangle([0, ih, PIN_WIDTH, ih + 8], fill=accent)

    ty = _wrap_draw(draw, title, 60, ih + 40, PIN_WIDTH - 120,
                    _font(42, True), (30, 30, 30), max_lines=3)

    if ingredients:
        ty += 15
        draw.text((60, ty), "INGREDIENTS", fill=accent, font=_font(22, True))
        ty += 40
        body = _font(20)
        for line in ingredients.strip().split("\n")[:8]:
            line = line.strip()
            if not line:
                continue
            if not line.startswith(("\u2022", "-", "*")):
                line = f"\u2022  {line}"
            draw.text((60, ty), line, fill=(80, 80, 80), font=body)
            ty += 32

    if website:
        _wrap_draw(draw, website, 60, PIN_HEIGHT - 45, PIN_WIDTH - 120,
                   _font(18), (160, 160, 160), align="center")
    return canvas


def _render_collage(
    images: list[Image.Image], title: str, ingredients: str, website: str,
) -> Image.Image:
    canvas = Image.new("RGBA", (PIN_WIDTH, PIN_HEIGHT), (20, 20, 20, 255))
    gap = 6
    cw = (PIN_WIDTH - gap) // 2
    ch = (PIN_HEIGHT - gap) // 2
    positions = [(0, 0), (cw + gap, 0), (0, ch + gap), (cw + gap, ch + gap)]
    for i, (px, py) in enumerate(positions):
        if i < len(images):
            img = _fit_crop(images[i], cw, ch)
            canvas.paste(img, (px, py))

    # Banner
    bh = 160
    by = (PIN_HEIGHT - bh) // 2
    banner = Image.new("RGBA", (PIN_WIDTH, bh), (0, 0, 0, 190))
    canvas.paste(banner, (0, by), banner)

    draw = ImageDraw.Draw(canvas)
    _wrap_draw(draw, title, 50, by + 20, PIN_WIDTH - 100,
               _font(46, True), "#ffffff", align="center", max_lines=2)

    if website:
        _wrap_draw(draw, website, 50, PIN_HEIGHT - 40, PIN_WIDTH - 100,
                   _font(18), (180, 180, 180), align="center")
    return canvas


# ── Template Registry ────────────────────────────────────

TEMPLATES: dict[str, dict] = {
    "recipe_card": {
        "name": "Recipe Card",
        "description": "Classic card with header, 2 photos side-by-side, and ingredients list",
        "image_count": 2,
        "render": _render_recipe_card,
        "colors": ["#2d5016", "#f5f0e8"],
    },
    "elegant": {
        "name": "Elegant Photo",
        "description": "Full-bleed food photo with gradient overlay and bold title",
        "image_count": 2,
        "render": _render_elegant,
        "colors": ["#1a1a2e", "#ffb432"],
    },
    "modern_split": {
        "name": "Modern Split",
        "description": "Photo on top, title and ingredients below with accent stripe",
        "image_count": 1,
        "render": _render_modern_split,
        "colors": ["#dc5a32", "#ffffff"],
    },
    "collage": {
        "name": "4-Photo Collage",
        "description": "All 4 images in a grid with title banner overlay",
        "image_count": 4,
        "render": _render_collage,
        "colors": ["#141414", "#ffffff"],
    },
}


# ── Public API ───────────────────────────────────────────

def list_templates() -> list[dict]:
    return [
        {
            "id": tid,
            "name": t["name"],
            "description": t["description"],
            "image_count": t["image_count"],
            "colors": t["colors"],
        }
        for tid, t in TEMPLATES.items()
    ]


def extract_ingredients(
    recipe_json_str: str | None, full_recipe: str | None,
) -> str:
    if recipe_json_str:
        try:
            data = json.loads(recipe_json_str)
            if isinstance(data, dict):
                ing_groups = data.get("recipe", data).get("ingredients", [])
                lines: list[str] = []
                for group in ing_groups:
                    if isinstance(group, dict):
                        items = group.get("ingredients", [group])
                        for it in items:
                            if isinstance(it, dict):
                                name = it.get("name", "") or it.get("ingredient", "")
                                amt = str(it.get("amount", ""))
                                unit = it.get("unit", "")
                                if name:
                                    lines.append(" ".join(p for p in [amt, unit, name] if p).strip())
                    elif isinstance(group, str):
                        lines.append(group)
                if lines:
                    return "\n".join(lines[:15])
        except Exception:
            pass

    if full_recipe:
        flines = full_recipe.split("\n")
        in_ing = False
        result: list[str] = []
        for fl in flines:
            s = fl.strip().lower()
            if "ingredient" in s and (":" in s or s.endswith("s")):
                in_ing = True
                continue
            if in_ing:
                if fl.strip() == "" and result:
                    break
                if any(kw in s for kw in ["instruction", "direction", "step", "method", "preparation", "notes"]):
                    break
                if fl.strip():
                    result.append(fl.strip())
        if result:
            return "\n".join(result[:15])

    return ""


def generate_pin(
    template_id: str,
    image_urls: list[str],
    title: str,
    ingredients: str = "",
    website: str = "",
) -> Image.Image:
    tmpl = TEMPLATES.get(template_id)
    if not tmpl:
        raise ValueError(f"Unknown template: {template_id}")
    imgs = _get_images(image_urls, tmpl["image_count"])
    return tmpl["render"](imgs, title, ingredients, website)


def generate_pin_base64(
    template_id: str,
    image_urls: list[str],
    title: str,
    ingredients: str = "",
    website: str = "",
) -> str:
    pin = generate_pin(template_id, image_urls, title, ingredients, website)
    buf = BytesIO()
    pin.convert("RGB").save(buf, format="JPEG", quality=88)
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/jpeg;base64,{b64}"
