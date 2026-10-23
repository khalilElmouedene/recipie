"""Prepare one article image from its source: 10% center zoom and horizontal mirror."""
from __future__ import annotations

import hashlib
import io
import ipaddress
import os
import socket
import threading
import uuid
from pathlib import Path
from typing import Callable
from urllib.parse import unquote, urljoin, urlparse

import requests
from fastapi import HTTPException
from PIL import Image, ImageOps
from sqlalchemy import select

from ..config import settings
from ..db_models import User
from .upload_storage import ensure_upload_capacity

SOURCE_PROVIDERS = ("source_image", "cloudflare")  # Old jobs also resume without AI image calls.
ZOOM = 1.10
MAX_BYTES = 25 * 1024 * 1024
_image_lock = threading.Lock()


def require_source_image_user(user: User) -> None:
    if (user.email or "").strip().lower() != "khalil@gmail.com":
        raise HTTPException(403, "Source Image Articles is only available to khalil@gmail.com")


async def authorize_source_image_job(db, user_id) -> None:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise ValueError("Article job creator no longer exists")
    require_source_image_user(user)


def _is_public_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        return False
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        return bool(addresses) and all(ipaddress.ip_address(address[4][0]).is_global for address in addresses)
    except (OSError, ValueError):
        return False


def _source_bytes(url: str, root: Path) -> bytes:
    parsed = urlparse(url)
    own_origin = urlparse(settings.server_base_url)
    path = unquote(parsed.path).replace("\\", "/")
    if path.startswith("/uploads/") and (not parsed.netloc or parsed.netloc == own_origin.netloc):
        local = (root / path.removeprefix("/uploads/")).resolve()
        if not local.is_relative_to(root.resolve()):
            raise ValueError("Invalid uploaded image path")
        if not local.is_file():
            raise ValueError("Uploaded source image is missing")
        if local.stat().st_size > MAX_BYTES:
            raise ValueError("Source image exceeds the 25 MB limit")
        return local.read_bytes()
    # Validate each redirect as well as the initial URL.
    current = url
    for _ in range(6):
        if not _is_public_url(current):
            raise ValueError("Use an uploaded image or a public HTTP(S) image URL")
        host = urlparse(current).hostname or "the source website"
        try:
            with requests.get(
                current, stream=True, timeout=(15, 60), allow_redirects=False,
                headers={"User-Agent": "Mozilla/5.0", "Accept": "image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5"},
            ) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("Location")
                    if not location:
                        raise ValueError("Source image redirect has no destination")
                    current = urljoin(current, location)
                    continue
                if response.status_code in (401, 403):
                    raise ValueError(
                        f"Source image access denied (HTTP {response.status_code}) by {host}. "
                        "Choose Upload and select the image file, or paste it from the clipboard, then start a new job."
                    )
                if response.status_code in (404, 410):
                    raise ValueError(
                        f"Source image is missing or its link expired (HTTP {response.status_code}) on {host}. "
                        "Use a working image URL or choose Upload and select the image file."
                    )
                if response.status_code >= 400:
                    raise ValueError(f"Source image download failed (HTTP {response.status_code}) on {host}. Retry later or upload the image file.")
                response.raise_for_status()
                data = bytearray()
                for chunk in response.iter_content(64 * 1024):
                    data.extend(chunk)
                    if len(data) > MAX_BYTES:
                        raise ValueError("Source image exceeds the 25 MB limit")
                return bytes(data)
        except requests.Timeout:
            raise ValueError(f"Source image download timed out on {host}. Retry or upload the image file.") from None
        except requests.exceptions.SSLError:
            raise ValueError(f"The source image server {host} has a TLS certificate error. Upload the image file instead.") from None
        except requests.RequestException:
            raise ValueError(f"Could not connect to the source image server {host}. Retry or upload the image file.") from None
    raise ValueError("Source image has too many redirects")


def prepare_image(image_url: str, *, recipe_id: str | None = None,
                  log: Callable[[str], None] = print,
                  should_stop: Callable[[], bool] = lambda: False) -> list[str]:
    if not image_url.strip():
        raise ValueError("A source image is required for Source Image Articles")
    if should_stop():
        return []
    root = Path(os.getenv("UPLOADS_DIR", "/app/uploads"))
    root.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(f"zoom-{ZOOM}-mirror-v1:{recipe_id or ''}:{image_url}".encode()).hexdigest()
    filename = f"source_{key}.jpg"
    target = root / filename
    url = f"{settings.server_base_url.rstrip('/')}/uploads/{filename}"
    with _image_lock:
        if should_stop():
            return []
        if target.is_file():
            log("Reusing the prepared source image.")
            return [url]
        data = _source_bytes(image_url, root)
        if should_stop():
            return []
        try:
            with Image.open(io.BytesIO(data)) as original:
                image = ImageOps.exif_transpose(original).convert("RGB")
                width, height = image.size
                crop_width, crop_height = max(1, round(width / ZOOM)), max(1, round(height / ZOOM))
                left, top = (width - crop_width) // 2, (height - crop_height) // 2
                cropped = image.crop((left, top, left + crop_width, top + crop_height))
                edited = ImageOps.mirror(cropped.resize((width, height), Image.Resampling.LANCZOS))
                output = io.BytesIO()
                edited.save(output, "JPEG", quality=95)
        except (ValueError, OSError, Image.DecompressionBombError):
            raise ValueError("Source image is not a valid or supported image") from None
        if should_stop():
            return []
        temporary = root / f".{filename}.{uuid.uuid4().hex}.tmp"
        try:
            ensure_upload_capacity(output.tell(), root)
            temporary.write_bytes(output.getvalue())
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        log(f"Source image prepared: 10% center zoom, horizontal mirror, {width}x{height}.")
        return [url]
