from __future__ import annotations

import logging
import time
from urllib.parse import urlencode

import requests

from app.config import settings

logger = logging.getLogger(__name__)

GRAPH_ROOT = "https://graph.facebook.com"
LOGIN_ROOT = "https://www.facebook.com"
REQUEST_TIMEOUT = 45
REEL_PROCESSING_TIMEOUT = 300
REEL_STATUS_INTERVAL = 3
REQUIRED_PAGE_PERMISSIONS = {
    "pages_manage_engagement",
    "pages_manage_posts",
    "pages_read_engagement",
}


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


def inspect_page_connection(
    *,
    page_access_token: str,
    app_id: str,
    app_secret: str,
    expected_page_id: str,
) -> dict:
    """Inspect a stored Page token without exposing either credential."""

    app_access_token = f"{app_id}|{app_secret}"
    response = requests.get(
        _graph("debug_token"),
        params={"input_token": page_access_token},
        headers={"Authorization": f"Bearer {app_access_token}"},
        timeout=REQUEST_TIMEOUT,
    )
    if not response.ok:
        raise _error(response, "Page token diagnostic")
    debug_data = response.json().get("data") or {}
    page = inspect_page_token(page_access_token)
    permissions = sorted(
        {
            str(scope)
            for scope in (debug_data.get("scopes") or [])
            if str(scope).strip()
        }
        | {
            str(item.get("scope"))
            for item in (debug_data.get("granular_scopes") or [])
            if isinstance(item, dict) and str(item.get("scope") or "").strip()
        }
    )
    missing_permissions = sorted(REQUIRED_PAGE_PERMISSIONS - set(permissions))
    token_app_id = str(debug_data.get("app_id") or "")
    return {
        "token_valid": bool(debug_data.get("is_valid")),
        "token_type": str(debug_data.get("type") or ""),
        "token_app_id": token_app_id,
        "app_matches": bool(token_app_id and token_app_id == str(app_id)),
        "page_id": page["id"],
        "page_matches": bool(page["id"] and page["id"] == str(expected_page_id)),
        "permissions": permissions,
        "missing_permissions": missing_permissions,
        "expires_at": int(debug_data.get("expires_at") or 0),
        "data_access_expires_at": int(debug_data.get("data_access_expires_at") or 0),
    }


def publish_reel(
    *,
    page_id: str,
    page_access_token: str,
    video_url: str,
    title: str,
    description: str,
) -> str:
    video_id, upload_url = start_reel_upload(
        page_id=page_id,
        page_access_token=page_access_token,
    )
    upload_hosted_reel(
        upload_url=upload_url,
        page_access_token=page_access_token,
        video_url=video_url,
    )
    finish_reel_publish(
        page_id=page_id,
        page_access_token=page_access_token,
        video_id=video_id,
        title=title,
        description=description,
    )
    return video_id


def reel_upload_url(video_id: str) -> str:
    return f"https://rupload.facebook.com/video-upload/{_version()}/{video_id}"


def start_reel_upload(*, page_id: str, page_access_token: str) -> tuple[str, str]:
    response = requests.post(
        _graph(f"{page_id}/video_reels"),
        data={
            "access_token": page_access_token,
            "upload_phase": "start",
        },
        timeout=REQUEST_TIMEOUT,
    )
    if not response.ok:
        raise _error(response, "Reel upload initialization")
    payload = response.json()
    video_id = str(payload.get("video_id") or "")
    upload_url = str(payload.get("upload_url") or "")
    if not video_id or not upload_url:
        raise ValueError(
            "Facebook Reel initialization did not include a video ID and upload URL."
        )
    return video_id, upload_url


def upload_hosted_reel(
    *, upload_url: str, page_access_token: str, video_url: str
) -> None:
    # Meta downloads the generated video from our public media URL. The upload
    # URL is returned by the start call and must not be reconstructed locally.
    response = requests.post(
        upload_url,
        headers={
            "Authorization": f"OAuth {page_access_token}",
            "file_url": video_url,
        },
        timeout=180,
    )
    if not response.ok:
        raise _error(response, "Reel video upload")
    if response.json().get("success") is not True:
        raise ValueError("Facebook did not accept the hosted Reel video URL.")


def finish_reel_publish(
    *,
    page_id: str,
    page_access_token: str,
    video_id: str,
    title: str,
    description: str,
) -> None:
    response = requests.post(
        _graph(f"{page_id}/video_reels"),
        data={
            "access_token": page_access_token,
            "video_id": video_id,
            "upload_phase": "finish",
            "video_state": "PUBLISHED",
            "title": title,
            "description": description,
        },
        timeout=180,
    )
    if not response.ok:
        raise _error(response, "Reel publishing")
    if response.json().get("success") is not True:
        raise ValueError("Facebook accepted the Reel upload but did not publish it.")


def get_reel_status(*, video_id: str, page_access_token: str) -> dict:
    response = requests.get(
        _graph(video_id),
        params={"fields": "status", "access_token": page_access_token},
        timeout=REQUEST_TIMEOUT,
    )
    if not response.ok:
        raise _error(response, "Reel processing status lookup")
    return response.json().get("status") or {}


def reel_is_published(status: dict) -> bool:
    video_status = str(status.get("video_status") or "").lower()
    publishing_phase = status.get("publishing_phase")
    publishing_status = str(
        (publishing_phase or {}).get("status") or ""
    ).lower()

    # Reels expose a dedicated publishing phase. ``video_status=ready`` only
    # proves that the media was encoded; it does not prove that Meta made the
    # Reel available. When the publishing phase is present, require it to be
    # complete. The video-status fallback is kept only for legacy Page videos
    # whose status payload has no publishing phase at all.
    if isinstance(publishing_phase, dict):
        return publishing_status == "complete"
    return video_status in {
        "complete",
        "published",
        "ready",
    }


def reel_has_failed(status: dict) -> bool:
    failure_states = {"error", "failed", "expired"}
    values = {
        str(status.get("video_status") or "").lower(),
        str((status.get("uploading_phase") or {}).get("status") or "").lower(),
        str((status.get("processing_phase") or {}).get("status") or "").lower(),
        str((status.get("publishing_phase") or {}).get("status") or "").lower(),
    }
    return bool(values & failure_states)


def reel_upload_is_complete(status: dict) -> bool:
    return (
        str((status.get("uploading_phase") or {}).get("status") or "").lower()
        == "complete"
    )


def reel_finish_has_started(status: dict) -> bool:
    processing_status = str(
        (status.get("processing_phase") or {}).get("status") or ""
    ).lower()
    publishing_status = str(
        (status.get("publishing_phase") or {}).get("status") or ""
    ).lower()
    return processing_status in {"in_progress", "complete"} or publishing_status in {
        "in_progress",
        "complete",
    }


def wait_for_reel_published(
    *,
    video_id: str,
    page_access_token: str,
    timeout: int = REEL_PROCESSING_TIMEOUT,
) -> dict:
    """Wait until Meta has processed and published a Reel.

    The video ID is persisted before this function is called, so a timeout or
    comment failure can be retried without creating a duplicate Reel.
    """

    deadline = time.monotonic() + timeout
    last_status: dict = {}
    while True:
        last_status = get_reel_status(
            video_id=video_id,
            page_access_token=page_access_token,
        )
        if reel_has_failed(last_status):
            error = (
                (last_status.get("publishing_phase") or {}).get("error")
                or (last_status.get("processing_phase") or {}).get("error")
                or last_status.get("error")
            )
            detail = f": {error}" if error else ""
            raise ValueError(f"Facebook failed while processing the Reel{detail}")

        # Meta uses the publishing phase for Reels. The video_status fallback
        # also supports already-published legacy Page videos during retries.
        if reel_is_published(last_status):
            return last_status

        if time.monotonic() >= deadline:
            raise ValueError(
                "Facebook accepted the Reel but it is still processing after "
                f"{timeout} seconds. Retry this publication later; the same Reel "
                "will be checked without uploading a duplicate."
            )
        time.sleep(REEL_STATUS_INTERVAL)


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
