from __future__ import annotations

import logging
from urllib.parse import urlencode

import requests

from app.config import settings

logger = logging.getLogger(__name__)

GRAPH_ROOT = "https://graph.facebook.com"
LOGIN_ROOT = "https://www.facebook.com"
REQUEST_TIMEOUT = 45


def _version() -> str:
    value = (settings.facebook_graph_version or "v24.0").strip()
    return value if value.startswith("v") else f"v{value}"


def _graph(path: str) -> str:
    return f"{GRAPH_ROOT}/{_version()}/{path.lstrip('/')}"


def _error(response: requests.Response, action: str) -> ValueError:
    try:
        payload = response.json()
        message = payload.get("error", {}).get("message") or payload.get("error_description")
    except Exception:
        message = None
    safe_message = str(message or response.reason or "request failed")[:500]
    logger.warning("Facebook Graph API %s failed (%s): %s", action, response.status_code, safe_message)
    return ValueError(f"Facebook {action} failed: {safe_message}")


def get_oauth_url(*, app_id: str, redirect_uri: str, state: str) -> str:
    params = {
        "client_id": app_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "response_type": "code",
        "scope": ",".join(
            [
                "pages_show_list",
                "pages_read_engagement",
                "pages_manage_posts",
                "pages_manage_engagement",
            ]
        ),
    }
    return f"{LOGIN_ROOT}/{_version()}/dialog/oauth?{urlencode(params)}"


def exchange_code_for_user_token(
    *, code: str, app_id: str, app_secret: str, redirect_uri: str
) -> dict:
    response = requests.get(
        _graph("oauth/access_token"),
        params={
            "client_id": app_id,
            "client_secret": app_secret,
            "redirect_uri": redirect_uri,
            "code": code,
        },
        timeout=REQUEST_TIMEOUT,
    )
    if not response.ok:
        raise _error(response, "OAuth code exchange")
    payload = response.json()
    if not payload.get("access_token"):
        raise ValueError("Facebook OAuth response did not include an access token.")
    return payload


def exchange_for_long_lived_user_token(
    *, access_token: str, app_id: str, app_secret: str
) -> dict:
    response = requests.get(
        _graph("oauth/access_token"),
        params={
            "grant_type": "fb_exchange_token",
            "client_id": app_id,
            "client_secret": app_secret,
            "fb_exchange_token": access_token,
        },
        timeout=REQUEST_TIMEOUT,
    )
    if not response.ok:
        raise _error(response, "long-lived token exchange")
    payload = response.json()
    if not payload.get("access_token"):
        raise ValueError("Facebook long-lived token response did not include an access token.")
    return payload


def get_managed_pages(user_access_token: str) -> list[dict]:
    response = requests.get(
        _graph("me/accounts"),
        params={
            "access_token": user_access_token,
            "fields": "id,name,access_token,picture{url},category,tasks",
            "limit": 100,
        },
        timeout=REQUEST_TIMEOUT,
    )
    if not response.ok:
        raise _error(response, "managed Pages lookup")
    pages = response.json().get("data") or []
    return [
        {
            "id": str(page.get("id") or ""),
            "name": str(page.get("name") or page.get("id") or "Facebook Page"),
            "access_token": str(page.get("access_token") or ""),
            "picture_url": ((page.get("picture") or {}).get("data") or {}).get("url"),
            "tasks": page.get("tasks") or [],
        }
        for page in pages
        if page.get("id") and page.get("access_token")
    ]


def inspect_page_token(access_token: str) -> dict:
    response = requests.get(
        _graph("me"),
        params={"access_token": access_token, "fields": "id,name,picture{url}"},
        timeout=REQUEST_TIMEOUT,
    )
    if not response.ok:
        raise _error(response, "Page token inspection")
    page = response.json()
    return {
        "id": str(page.get("id") or ""),
        "name": str(page.get("name") or page.get("id") or "Facebook Page"),
        "picture_url": ((page.get("picture") or {}).get("data") or {}).get("url"),
    }


def publish_video(
    *,
    page_id: str,
    page_access_token: str,
    video_url: str,
    title: str,
    description: str,
) -> str:
    response = requests.post(
        _graph(f"{page_id}/videos"),
        data={
            "access_token": page_access_token,
            "file_url": video_url,
            "title": title,
            "description": description,
            "published": "true",
        },
        timeout=180,
    )
    if not response.ok:
        raise _error(response, "video publishing")
    post_id = str(response.json().get("id") or "")
    if not post_id:
        raise ValueError("Facebook video publishing response did not include a post ID.")
    return post_id


def add_first_comment(*, post_id: str, page_access_token: str, message: str) -> str | None:
    response = requests.post(
        _graph(f"{post_id}/comments"),
        data={"access_token": page_access_token, "message": message},
        timeout=REQUEST_TIMEOUT,
    )
    if not response.ok:
        raise _error(response, "first comment")
    comment_id = response.json().get("id")
    return str(comment_id) if comment_id else None
