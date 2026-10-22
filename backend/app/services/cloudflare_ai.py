"""Cloudflare image generation, with permanent files and resumable image batches."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import threading
import uuid
from pathlib import Path
from typing import Callable

import requests
from PIL import Image
from fastapi import HTTPException
from sqlalchemy import select

from ..config import settings
from ..crypto import decrypt
from ..db_models import User, UserCredential

MODEL = "@cf/black-forest-labs/flux-1-schnell"
ALLOWED_EMAIL = "khalil@gmail.com"
KEY_TYPES = {"cloudflare_account_id", "cloudflare_api_token"}
_generation_lock = threading.Lock()


def require_cloudflare_user(user: User) -> None:
    if (user.email or "").strip().lower() != ALLOWED_EMAIL:
        raise HTTPException(403, "Cloudflare article generation is only available to khalil@gmail.com")


async def load_cloudflare_credentials(db, user_id) -> dict[str, str]:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise ValueError("Cloudflare job creator no longer exists")
    require_cloudflare_user(user)
    rows = (await db.execute(select(UserCredential).where(
        UserCredential.user_id == user_id, UserCredential.key_type.in_(KEY_TYPES),
    ))).scalars().all()
    values = {row.key_type: decrypt(row.encrypted_value).strip() for row in rows}
    validate_credentials(values)
    return values


def validate_credentials(values: dict) -> None:
    if not re.fullmatch(r"[0-9a-fA-F]{32}", values.get("cloudflare_account_id", "")):
        raise ValueError("Save a valid 32-character Cloudflare Account ID on the Cloudflare Articles page.")
    if not values.get("cloudflare_api_token", "").strip():
        raise ValueError("Save a Cloudflare Workers AI API token on the Cloudflare Articles page.")


def generate_images(
    recipe_text: str, credentials: dict, *, recipe_id: str | None = None,
    count: int = 4, log: Callable[[str], None] = print,
    should_stop: Callable[[], bool] = lambda: False,
) -> list[str]:
    validate_credentials(credentials)
    prompt = (
        "Professional editorial food photograph of the finished dish described below. "
        "Faithfully show its ingredients and preparation. Natural window light, realistic textures, "
        "appetizing presentation, simple table setting, no text, no watermark. Recipe: "
        + recipe_text.strip()
    )[:2048]
    if not recipe_text.strip():
        raise ValueError("Recipe text is required for Cloudflare images")
    root = Path(os.getenv("UPLOADS_DIR", "/app/uploads"))
    root.mkdir(parents=True, exist_ok=True)
    cache_key = hashlib.sha256(f"{recipe_id or uuid.uuid4().hex}:{MODEL}:{prompt}".encode()).hexdigest()
    manifest = root / f".cloudflare-{cache_key}.json"
    # Serializes calls and cache writes, including concurrent retries of the same recipe.
    with _generation_lock:
        files: list[str] = []
        if manifest.exists():
            try:
                files = [name for name in json.loads(manifest.read_text())
                         if isinstance(name, str) and re.fullmatch(r"cf_[a-f0-9]{32}\.jpg", name)
                         and (root / name).is_file()]
            except (ValueError, TypeError):
                files = []
        if files:
            log(f"Reusing {len(files)} cached Cloudflare image(s).")
        while len(files) < count:
            if should_stop():
                return []
            log(f"Cloudflare FLUX: generating image {len(files) + 1}/{count}...")
            try:
                response = requests.post(
                    f"https://api.cloudflare.com/client/v4/accounts/{credentials['cloudflare_account_id']}/ai/run/{MODEL}",
                    headers={"Authorization": f"Bearer {credentials['cloudflare_api_token']}"},
                    json={"prompt": prompt, "steps": 4}, timeout=120,
                )
            except requests.RequestException:
                raise RuntimeError("Cloudflare could not be reached. Check the connection and retry.") from None
            if response.status_code == 429:
                raise RuntimeError("Cloudflare rate limit or daily Neuron quota reached. Check Workers AI usage and retry later.")
            if response.status_code in (401, 403):
                raise RuntimeError("Cloudflare rejected the credentials. Check Account ID and Workers AI Read/Edit permissions.")
            try:
                payload = response.json()
            except ValueError:
                raise RuntimeError(f"Cloudflare returned an invalid response (HTTP {response.status_code}).") from None
            if not response.ok or payload.get("success") is False:
                codes = [str(e.get("code", "")) for e in payload.get("errors", []) if isinstance(e, dict)]
                if "4006" in codes:
                    raise RuntimeError("Cloudflare daily free allocation exhausted. Wait for the daily reset or review your Workers AI plan.")
                raise RuntimeError(f"Cloudflare image generation failed (HTTP {response.status_code}, codes: {', '.join(codes) or 'unknown'}).")
            encoded = (payload.get("result") or {}).get("image")
            try:
                data = base64.b64decode(encoded, validate=True)
                # Validate and normalize the returned image before exposing a permanent URL.
                with Image.open(io.BytesIO(data)) as img:
                    img.load()
                    normalized = io.BytesIO()
                    img.convert("RGB").save(normalized, "JPEG", quality=95)
            except (ValueError, TypeError, OSError):
                raise RuntimeError("Cloudflare returned no valid image.") from None
            filename = f"cf_{uuid.uuid4().hex}.jpg"
            (root / filename).write_bytes(normalized.getvalue())
            files.append(filename)
            temp = manifest.with_suffix(".tmp")
            temp.write_text(json.dumps(files), encoding="utf-8")
            temp.replace(manifest)
        return [f"{settings.server_base_url.rstrip('/')}/uploads/{name}" for name in files[:count]]
