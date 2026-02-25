from __future__ import annotations
import time
import requests


def create_pin(
    access_token: str,
    board_id: str,
    image_url: str,
    title: str,
    description: str,
    link: str = "",
) -> dict:
    """Create a single Pinterest pin via the v5 API.
    Returns {"pin_id": ..., "pin_url": ...} on success or {"error": ...} on failure.
    """
    url = "https://api.pinterest.com/v5/pins"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    payload: dict = {
        "board_id": board_id,
        "title": title[:100],
        "description": description[:500],
        "media_source": {
            "source_type": "image_url",
            "url": image_url,
        },
    }
    if link:
        payload["link"] = link

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=30)
        if resp.status_code in (200, 201):
            data = resp.json()
            pin_id = data.get("id", "")
            pin_url = f"https://www.pinterest.com/pin/{pin_id}/" if pin_id else ""
            return {"pin_id": pin_id, "pin_url": pin_url}
        else:
            detail = resp.text[:300]
            return {"error": f"Pinterest API {resp.status_code}: {detail}"}
    except Exception as e:
        return {"error": str(e)}


def create_pins_bulk(
    access_token: str,
    board_id: str,
    images: list[str],
    title: str,
    description: str,
    link: str = "",
) -> dict:
    """Create Pinterest pins for multiple images.
    Returns a summary dict compatible with PinterestBulkResponse.
    """
    pins = []
    created = 0
    failed = 0

    for idx, image_url in enumerate(images):
        pin_title = f"{title}" if len(images) == 1 else f"{title} #{idx + 1}"
        result = create_pin(
            access_token=access_token,
            board_id=board_id,
            image_url=image_url,
            title=pin_title,
            description=description,
            link=link,
        )

        pin_entry = {"image_url": image_url}
        if "error" in result:
            pin_entry["error"] = result["error"]
            failed += 1
        else:
            pin_entry["pin_id"] = result["pin_id"]
            pin_entry["pin_url"] = result["pin_url"]
            created += 1

        pins.append(pin_entry)

        if idx < len(images) - 1:
            time.sleep(1)

    return {
        "total": len(images),
        "created": created,
        "failed": failed,
        "pins": pins,
    }


def get_boards(access_token: str) -> list[dict]:
    """Fetch the user's Pinterest boards. Returns list of {id, name}."""
    url = "https://api.pinterest.com/v5/boards"
    headers = {"Authorization": f"Bearer {access_token}"}

    try:
        resp = requests.get(url, headers=headers, params={"page_size": 50}, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            return [
                {"id": b["id"], "name": b["name"]}
                for b in data.get("items", [])
            ]
        return []
    except Exception:
        return []
