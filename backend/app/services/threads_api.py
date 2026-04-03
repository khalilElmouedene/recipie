from __future__ import annotations

import time
import urllib.parse

import requests

from ..config import settings

_GRAPH_BASE = "https://graph.threads.net/v1.0"
_AUTH_BASE = "https://threads.net/oauth/authorize"
_TOKEN_URL = "https://graph.threads.net/oauth/access_token"
_LONG_LIVED_TOKEN_URL = f"{_GRAPH_BASE}/access_token"
_REFRESH_TOKEN_URL = f"{_GRAPH_BASE}/refresh_access_token"


def get_oauth_url(state: str) -> str:
    """Build the Threads OAuth authorization URL."""
    params = {
        "client_id": settings.threads_app_id.strip(),
        "redirect_uri": settings.threads_redirect_uri.strip(),
        "scope": "threads_basic,threads_content_publish,threads_manage_replies",
        "response_type": "code",
        "state": state,
    }
    return f"{_AUTH_BASE}?{urllib.parse.urlencode(params)}"


def exchange_code_for_token(code: str) -> dict:
    """Exchange OAuth code for a short-lived token, then upgrade to long-lived (60 days).

    Returns dict with keys: access_token, user_id, expires_in
    """
    # Step 1: exchange code for short-lived token
    resp = requests.post(
        _TOKEN_URL,
        data={
            "client_id": settings.threads_app_id.strip(),
            "client_secret": settings.threads_app_secret.strip(),
            "grant_type": "authorization_code",
            "redirect_uri": settings.threads_redirect_uri.strip(),
            "code": code,
        },
        timeout=30,
    )
    if not resp.ok:
        raise ValueError(f"Threads token exchange failed: {resp.text}")
    short_data = resp.json()
    short_token = short_data.get("access_token")
    user_id = short_data.get("user_id") or short_data.get("id")
    if not short_token:
        raise ValueError(f"No access_token in Threads response: {short_data}")

    # Step 2: upgrade to long-lived token
    long_resp = requests.get(
        _LONG_LIVED_TOKEN_URL,
        params={
            "grant_type": "th_exchange_token",
            "client_secret": settings.threads_app_secret,
            "access_token": short_token,
        },
        timeout=30,
    )
    if not long_resp.ok:
        raise ValueError(f"Threads long-lived token exchange failed: {long_resp.text}")
    long_data = long_resp.json()
    long_token = long_data.get("access_token")
    if not long_token:
        raise ValueError(f"No access_token in long-lived Threads response: {long_data}")

    return {
        "access_token": long_token,
        "user_id": str(user_id),
        "expires_in": long_data.get("expires_in", 5183944),  # ~60 days in seconds
    }


def refresh_token(access_token: str) -> dict:
    """Refresh a long-lived Threads token.

    Returns dict with keys: access_token, expires_in
    """
    resp = requests.get(
        _REFRESH_TOKEN_URL,
        params={
            "grant_type": "th_refresh_token",
            "access_token": access_token,
        },
        timeout=30,
    )
    if not resp.ok:
        raise ValueError(f"Threads token refresh failed: {resp.text}")
    data = resp.json()
    new_token = data.get("access_token")
    if not new_token:
        raise ValueError(f"No access_token in Threads refresh response: {data}")
    return {
        "access_token": new_token,
        "expires_in": data.get("expires_in", 5183944),
    }


def get_user_info(access_token: str, user_id: str) -> dict:
    """Fetch Threads user profile (id, username, threads_profile_picture_url).

    Returns dict with keys: id, username, threads_profile_picture_url
    """
    resp = requests.get(
        f"{_GRAPH_BASE}/{user_id}",
        params={
            "fields": "id,username,threads_profile_picture_url",
            "access_token": access_token,
        },
        timeout=30,
    )
    if not resp.ok:
        raise ValueError(f"Threads get_user_info failed: {resp.text}")
    data = resp.json()
    if "error" in data:
        raise ValueError(f"Threads get_user_info error: {data['error']}")
    return data


def _is_video_url(url: str) -> bool:
    lower = url.lower().split("?")[0]
    return lower.endswith(".mp4") or lower.endswith(".mov") or "/threads/" in lower and "video" in lower


def _create_container(user_id: str, access_token: str, params: dict) -> str:
    req = requests.Request(
        "POST",
        f"{_GRAPH_BASE}/{user_id}/threads",
        params={**params, "access_token": access_token},
    )
    prepared = req.prepare()
    print(f"[threads DEBUG] container request URL: {prepared.url}", flush=True)
    resp = requests.Session().send(prepared, timeout=60)
    if not resp.ok:
        raise ValueError(f"Threads container creation failed: {resp.text}")
    data = resp.json()
    cid = data.get("id")
    if not cid:
        raise ValueError(f"No container id in Threads response: {data}")
    return str(cid)


def _publish_container(user_id: str, access_token: str, creation_id: str) -> str:
    resp = requests.post(
        f"{_GRAPH_BASE}/{user_id}/threads_publish",
        params={"creation_id": creation_id, "access_token": access_token},
        timeout=60,
    )
    if not resp.ok:
        raise ValueError(f"Threads publish failed: {resp.text}")
    data = resp.json()
    post_id = data.get("id")
    if not post_id:
        raise ValueError(f"No post id in Threads publish response: {data}")
    return str(post_id)


def publish_post(
    access_token: str,
    user_id: str,
    text: str,
    media_urls: list[str] | None = None,
    image_url: str | None = None,
) -> str:
    """Create a Threads media container then publish it.

    Supports: text-only, single image, single video, carousel (multiple images).
    Returns the threads_post_id string on success.
    Raises ValueError on failure.
    """
    # Normalise media list (prefer media_urls, fall back to legacy image_url)
    urls: list[str] = []
    if media_urls:
        urls = [u for u in media_urls if u]
    elif image_url:
        urls = [image_url]

    if len(urls) == 0:
        # Text-only post
        creation_id = _create_container(user_id, access_token, {"media_type": "TEXT", "text": text})
        time.sleep(5)
        return _publish_container(user_id, access_token, creation_id)

    if len(urls) == 1:
        # Single image or video
        url = urls[0]
        if _is_video_url(url):
            creation_id = _create_container(user_id, access_token, {
                "media_type": "VIDEO",
                "video_url": url,
                "text": text,
            })
        else:
            creation_id = _create_container(user_id, access_token, {
                "media_type": "IMAGE",
                "image_url": url,
                "text": text,
            })
        time.sleep(5)
        return _publish_container(user_id, access_token, creation_id)

    # Carousel: multiple images (Threads supports up to 20 images)
    item_ids: list[str] = []
    for url in urls[:20]:
        item_id = _create_container(user_id, access_token, {
            "is_carousel_item": "true",
            "media_type": "IMAGE",
            "image_url": url,
        })
        item_ids.append(item_id)
        time.sleep(1)

    carousel_id = _create_container(user_id, access_token, {
        "media_type": "CAROUSEL",
        "children": ",".join(item_ids),
        "text": text,
    })
    time.sleep(5)
    return _publish_container(user_id, access_token, carousel_id)


def add_reply(
    access_token: str,
    user_id: str,
    post_id: str,
    text: str,
) -> str:
    """Create a reply container targeting post_id, then publish it.

    Returns the reply threads_post_id string on success.
    Raises ValueError on failure.
    """
    # Step 1: create reply container
    container_resp = requests.post(
        f"{_GRAPH_BASE}/{user_id}/threads",
        params={
            "media_type": "TEXT",
            "text": text,
            "reply_to_id": post_id,
            "access_token": access_token,
        },
        timeout=60,
    )
    if not container_resp.ok:
        raise ValueError(f"Threads reply container creation failed: {container_resp.text}")
    container_data = container_resp.json()
    creation_id = container_data.get("id")
    if not creation_id:
        raise ValueError(f"No container id in Threads reply response: {container_data}")

    # Wait for Meta to process the reply container before publishing
    time.sleep(5)

    # Step 2: publish reply
    publish_resp = requests.post(
        f"{_GRAPH_BASE}/{user_id}/threads_publish",
        params={
            "creation_id": creation_id,
            "access_token": access_token,
        },
        timeout=60,
    )
    if not publish_resp.ok:
        raise ValueError(f"Threads reply publish failed: {publish_resp.text}")
    publish_data = publish_resp.json()
    reply_id = publish_data.get("id")
    if not reply_id:
        raise ValueError(f"No reply id in Threads publish response: {publish_data}")
    return str(reply_id)
