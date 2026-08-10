from __future__ import annotations

import base64
import logging
import os
import shutil
import uuid
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urlparse

import requests
from openai import OpenAI
from PIL import Image

from app.config import settings


logger = logging.getLogger(__name__)
UPLOADS_ROOT = Path(os.getenv("UPLOADS_DIR", "/app/uploads"))
FACEBOOK_UPLOADS = UPLOADS_ROOT / "facebook"
MAX_IMAGE_BYTES = 25 * 1024 * 1024


def _render_prompt(
    template: str,
    recipe_title: str,
    recipe_post: str,
    ingredient_recipe: str,
) -> str:
    rendered = str(template or "").replace("{recipe_title}", recipe_title)
    rendered = rendered.replace("{recipe_post}", recipe_post)
    rendered = rendered.replace("{ingredient_recipe}", ingredient_recipe)
    return (
        "You receive exactly two reference images. The FIRST image is the design "
        "template. The SECOND image is the source food image. Follow the Page's "
        "instructions below, preserve readable text, and return one finished social "
        "media image.\n\n"
        f"Recipe title:\n{recipe_title}\n\n"
        f"First 8 ingredients:\n{ingredient_recipe}\n\n"
        f"Rewritten Recipe Post:\n{recipe_post}\n\n"
        f"Page instructions:\n{rendered}"
    )


def _local_upload_path(raw_url: str) -> Path | None:
    parsed = urlparse(raw_url)
    path = unquote(parsed.path if parsed.scheme else raw_url).replace("\\", "/")
    marker = "/uploads/"
    if marker not in path:
        return None
    relative = path.split(marker, 1)[1]
    candidate = (UPLOADS_ROOT / relative).resolve()
    try:
        candidate.relative_to(UPLOADS_ROOT.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


def _copy_or_download_image(url: str, destination: Path) -> None:
    local = _local_upload_path(url)
    if local is not None:
        shutil.copyfile(local, destination)
    else:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError("Image source must be an uploaded image or a public HTTP(S) URL.")
        try:
            with requests.get(url, stream=True, timeout=(15, 90)) as response:
                response.raise_for_status()
                content_type = str(response.headers.get("content-type") or "").lower()
                if content_type and not content_type.startswith("image/"):
                    raise ValueError(f"Image URL returned {content_type} instead of an image.")
                written = 0
                with destination.open("wb") as output:
                    for chunk in response.iter_content(1024 * 1024):
                        if not chunk:
                            continue
                        written += len(chunk)
                        if written > MAX_IMAGE_BYTES:
                            raise ValueError("Image source exceeds the 25 MB limit.")
                        output.write(chunk)
        except requests.RequestException as exc:
            raise ValueError(f"Could not download image source: {exc}") from exc
    try:
        with Image.open(destination) as image:
            image.load()
            normalized = BytesIO()
            image.convert("RGB").save(normalized, format="PNG", optimize=True)
        destination.write_bytes(normalized.getvalue())
    except Exception as exc:
        destination.unlink(missing_ok=True)
        raise ValueError("Image source is not a valid JPG, PNG, or WebP image.") from exc


class FacebookImagePostGenerator:
    """Generate one Page-specific post image from template + source images."""

    def generate(
        self,
        *,
        content_id: uuid.UUID,
        delivery_id: uuid.UUID,
        template_image_url: str,
        source_image_url: str,
        recipe_post: str,
        recipe_title: str,
        ingredient_recipe: str,
        prompt: str,
        model: str,
        quality: str,
        openai_api_key: str,
        log=lambda _message: None,
    ) -> str:
        work_dir = FACEBOOK_UPLOADS / str(content_id)
        work_dir.mkdir(parents=True, exist_ok=True)
        template_path = work_dir / f"template-{delivery_id}.png"
        source_path = work_dir / f"source-image-{delivery_id}.png"
        output_path = work_dir / f"image-post-{delivery_id}.png"

        log("Preparing Template Image and Source Image.")
        _copy_or_download_image(template_image_url, template_path)
        _copy_or_download_image(source_image_url, source_path)

        client = OpenAI(api_key=openai_api_key)
        log(f"Generating the Page image with {model} ({quality} quality).")
        with template_path.open("rb") as template, source_path.open("rb") as source:
            result = client.images.edit(
                model=model,
                image=[template, source],
                prompt=_render_prompt(
                    prompt,
                    recipe_title,
                    recipe_post,
                    ingredient_recipe,
                ),
                quality=quality,
                size="1024x1536",
            )
        image_base64 = result.data[0].b64_json if result.data else None
        if not image_base64:
            raise ValueError("OpenAI returned an empty image post.")
        try:
            generated = Image.open(BytesIO(base64.b64decode(image_base64))).convert("RGB")
            generated.save(output_path, format="PNG", optimize=True)
        except Exception as exc:
            output_path.unlink(missing_ok=True)
            raise ValueError("OpenAI returned an invalid generated image.") from exc

        log(f"Generated Page image at {generated.width}x{generated.height}.")
        return (
            f"{settings.server_base_url.rstrip('/')}/uploads/facebook/"
            f"{content_id}/{output_path.name}"
        )
