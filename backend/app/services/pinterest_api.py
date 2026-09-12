"""Async Pinterest v5 API. Secrets and upstream response bodies are never logged."""
from __future__ import annotations

import base64
import binascii
import re
from urllib.parse import urlparse
import httpx
from ..config import settings

API_URL = "https://api.pinterest.com/v5"
SCOPES = "boards:read,boards:write,pins:read,pins:write,user_accounts:read"


class PinterestError(Exception):
    def __init__(self, message: str, *, uncertain: bool = False, retryable: bool = False, reconnect: bool = False):
        super().__init__(message)
        self.uncertain = uncertain
        self.retryable = retryable
        self.reconnect = reconnect


async def request(method: str, path: str, token: str = "", **kwargs) -> dict:
    is_pin_create = method == "POST" and path == "/pins"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30, connect=10), follow_redirects=False) as client:
            response = await client.request(method, API_URL + path,
                headers={"Authorization": f"Bearer {token}"} if token else {}, **kwargs)
    except httpx.RequestError:
        raise PinterestError("Pinterest could not be reached. " + (
            "The pin may have been created; check Pinterest before retrying." if is_pin_create else "Try again later."
        ), uncertain=is_pin_create, retryable=not is_pin_create) from None
    if not 200 <= response.status_code < 300:
        status = response.status_code
        uncertain = is_pin_create and (status >= 500 or status == 408)
        message = {
            400: "Pinterest rejected the content. Check the board, image and pin fields.",
            401: "Pinterest authorization expired. Reconnect the account.",
            403: "Pinterest denied access. Check app approval and token permissions (boards:write and pins:write). Generated production test tokens are read-only.",
            404: "Pinterest board or pin was not found.",
            429: "Pinterest rate limit reached. Publishing will retry later.",
        }.get(status, "Pinterest request failed.")
        if uncertain:
            message += " The pin may have been created; check Pinterest before retrying."
        raise PinterestError(f"{message} (HTTP {status})", uncertain=uncertain,
            retryable=status == 429 or (status >= 500 and not uncertain), reconnect=status == 401)
    try:
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except ValueError:
        raise PinterestError("Pinterest returned an invalid response.", uncertain=is_pin_create, retryable=not is_pin_create) from None


async def exchange_token(*, client_id: str | None = None, client_secret: str | None = None, **data) -> dict:
    client_id = settings.pinterest_client_id if client_id is None else client_id
    client_secret = settings.pinterest_client_secret if client_secret is None else client_secret
    if not client_id or not client_secret:
        raise PinterestError("Pinterest OAuth is not configured on the server.", reconnect=True)
    result = await request("POST", "/oauth/token", data=data,
        auth=(client_id, client_secret))
    if not result.get("access_token") or not result.get("expires_in"):
        raise PinterestError("Pinterest did not return a valid access token.", reconnect=True)
    return result


def normalize_board(name: str) -> str:
    return " ".join(name.split()).casefold()


async def ensure_board(token: str, name: str, username: str, *, progress=None) -> str:
    bookmark = None
    seen = set()
    while True:
        data = await request("GET", "/boards", token, params={
            "page_size": 100, **({"bookmark": bookmark} if bookmark else {})})
        for board in data.get("items", []):
            owner = (board.get("owner") or {}).get("username", "")
            if normalize_board(board.get("name", "")) == normalize_board(name) and owner.casefold() == username.casefold():
                if progress:
                    await progress("board_found", f"Using existing board {board["id"]}: {name}")
                return str(board["id"])
        bookmark = data.get("bookmark")
        if not bookmark:
            break
        if bookmark in seen:
            raise PinterestError("Pinterest board pagination did not complete.", retryable=True)
        seen.add(bookmark)
    if progress:
        await progress("board_creating", f"Board not found. Creating public board: {name}")
    board = await request("POST", "/boards", token, json={"name": name.strip(), "privacy": "PUBLIC"})
    if not board.get("id"):
        raise PinterestError("Pinterest did not return a board ID.", retryable=True)
    if progress:
        await progress("board_created", f"Created board {board["id"]}: {name}")
    return str(board["id"])


def pin_description(description: str, keywords: str) -> str:
    text = description.strip()[:500]
    # Preserve existing prose; only add absent keywords that fit without cutting it.
    tags = [tag.strip().lstrip("#") for tag in re.split(r"[,;\n]+", keywords) if tag.strip()]
    missing = list(dict.fromkeys(tag for tag in tags if tag.casefold() not in text.casefold()))
    if missing:
        extra = " Explore more: " + ", ".join(missing) + "."
        if len(text + extra) <= 500:
            text += extra
    return text.strip()


def pin_payload(item) -> dict:
    if not item.board_name.strip() or len(item.board_name.strip()) > 180:
        raise PinterestError("A board name between 1 and 180 characters is required.")
    if not item.title.strip():
        raise PinterestError("A pin title is required.")
    destination = urlparse(item.article_url)
    if destination.scheme not in ("http", "https") or not destination.hostname:
        raise PinterestError("An article URL is required. Publish the article before retrying.")
    image_url = item.image_url.strip()
    if image_url.startswith("data:"):
        header, _, content = image_url.partition(",")
        mime = header.removeprefix("data:").split(";")[0]
        if mime not in ("image/png", "image/jpeg") or ";base64" not in header or len(content) > 14_000_000:
            raise PinterestError("Use a PNG or JPEG pin image smaller than 10 MB.")
        try:
            raw = base64.b64decode(content, validate=True)
            if not raw or len(raw) > 10 * 1024 * 1024:
                raise ValueError()
        except (ValueError, binascii.Error):
            raise PinterestError("The pin image data is invalid.") from None
        media = {"source_type": "image_base64", "content_type": mime, "data": content}
    else:
        parsed = urlparse(image_url)
        if parsed.scheme not in ("https", "http") or not parsed.hostname:
            raise PinterestError("A publicly accessible Pinterest pin image is required.")
        media = {"source_type": "image_url", "url": image_url}
    return {"title": item.title.strip()[:100], "description": pin_description(item.description, item.keywords),
        "link": item.article_url, "media_source": media}
