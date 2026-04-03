from __future__ import annotations

import re


def _public_id_from_url(url: str) -> tuple[str, str] | None:
    """Extract (public_id, resource_type) from a Cloudinary secure_url.

    Example URL:
      https://res.cloudinary.com/<cloud>/image/upload/v1234/threads/abc123.jpg
    Returns:
      ("threads/abc123", "image")
    """
    # Match: .../image/upload/... or .../video/upload/...
    m = re.search(r"/(image|video)/upload/(?:v\d+/)?(.+?)(?:\.[^.]+)?$", url)
    if not m:
        return None
    resource_type = m.group(1)
    public_id = m.group(2)
    return public_id, resource_type


def delete_cloudinary_media(urls: list[str], cloud_name: str, api_key: str, api_secret: str) -> None:
    """Delete a list of Cloudinary media URLs. Silently ignores non-Cloudinary URLs and errors."""
    if not urls or not cloud_name:
        return

    import cloudinary
    import cloudinary.uploader

    cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret)

    for url in urls:
        if not url or "res.cloudinary.com" not in url:
            continue
        parsed = _public_id_from_url(url)
        if not parsed:
            continue
        public_id, resource_type = parsed
        try:
            cloudinary.uploader.destroy(public_id, resource_type=resource_type)
        except Exception as e:
            print(f"[cloudinary] failed to delete {public_id}: {e}", flush=True)
