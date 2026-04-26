from __future__ import annotations

import asyncio
import html
import json
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from sqlalchemy import select

from app.database import SessionLocal
from app.db_models import AutoSpySheet, AutoSpySource


_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; AutoSpy/1.0)"}
_TIMEOUT = httpx.Timeout(20.0, connect=5.0)


def _normalize_url(raw: str) -> str:
    raw = raw.strip().rstrip("/")
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    return raw


def _domain_from_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc or parsed.path
    return host.removeprefix("www.")


async def _scrape_wp_rest(base_url: str, after: datetime | None) -> list[dict]:
    params: dict = {"per_page": 50, "orderby": "date", "order": "desc", "_embed": "wp:featuredmedia"}
    if after:
        params["after"] = after.strftime("%Y-%m-%dT%H:%M:%SZ")
    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(f"{base_url}/wp-json/wp/v2/posts", params=params)
        resp.raise_for_status()
        posts = resp.json()

    results = []
    for post in posts:
        title = html.unescape(post.get("title", {}).get("rendered", "")).strip()
        if not title:
            continue
        image_url = ""
        try:
            media_list = post.get("_embedded", {}).get("wp:featuredmedia", [])
            if media_list:
                image_url = media_list[0].get("source_url", "")
        except Exception:
            pass
        if image_url:
            results.append({"image_url": image_url, "recipe_text": title})
    return results


async def _scrape_rss(base_url: str) -> list[dict]:
    import xml.etree.ElementTree as ET

    async with httpx.AsyncClient(headers=_HEADERS, timeout=_TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(f"{base_url}/feed/")
        resp.raise_for_status()
        root = ET.fromstring(resp.text)

    ns = {
        "media": "http://search.yahoo.com/mrss/",
        "content": "http://purl.org/rss/1.0/modules/content/",
    }
    results = []
    for item in root.iter("item"):
        title_el = item.find("title")
        title = html.unescape(title_el.text or "").strip() if title_el is not None else ""
        if not title:
            continue
        image_url = ""
        media_content = item.find("media:content", ns)
        if media_content is not None:
            image_url = media_content.get("url", "")
        if not image_url:
            enclosure = item.find("enclosure")
            if enclosure is not None and (enclosure.get("type", "").startswith("image")):
                image_url = enclosure.get("url", "")
        if image_url:
            results.append({"image_url": image_url, "recipe_text": title})
    return results


async def scrape_source_rows(url: str, after: datetime | None) -> list[dict]:
    base_url = _normalize_url(url)
    try:
        return await _scrape_wp_rest(base_url, after)
    except Exception:
        pass
    try:
        return await _scrape_rss(base_url)
    except Exception:
        return []


def _make_empty_sheet_data(rows: int = 50, cols: int = 10) -> dict:
    return {"cells": {}, "colWidths": {}, "rowHeights": {}, "rows": rows, "cols": cols}


def _make_sheet_tab(tab_id: str, name: str) -> dict:
    data = _make_empty_sheet_data()
    data["cells"]["0_0"] = {"v": "image_url"}
    data["cells"]["0_1"] = {"v": "recipe_text"}
    return {"id": tab_id, "name": name, "data": data}


def _load_workbook(raw: str | None) -> dict:
    if raw:
        try:
            return json.loads(raw)
        except Exception:
            pass
    return {"sheets": [], "activeId": ""}


def _save_workbook(workbook: dict) -> str:
    return json.dumps(workbook)


def _append_rows_to_tab(workbook: dict, tab_id: str, rows: list[dict]) -> dict:
    tab = next((s for s in workbook.get("sheets", []) if s["id"] == tab_id), None)
    if tab is None:
        return workbook

    cells: dict = tab["data"].get("cells", {})
    # find next empty row (skip header row 0)
    occupied_rows = {int(k.split("_")[0]) for k in cells if "_" in k}
    next_row = max(occupied_rows, default=0) + 1

    for item in rows:
        cells[f"{next_row}_0"] = {"v": item.get("image_url", "")}
        cells[f"{next_row}_1"] = {"v": item.get("recipe_text", "")}
        next_row += 1

    tab["data"]["cells"] = cells
    tab["data"]["rows"] = max(tab["data"].get("rows", 50), next_row + 10)
    return workbook


async def scan_source(source_id: uuid.UUID) -> None:
    async with SessionLocal() as db:
        result = await db.execute(select(AutoSpySource).where(AutoSpySource.id == source_id))
        source = result.scalar_one_or_none()
        if source is None:
            return

        rows = await scrape_source_rows(source.url, source.last_scanned_at)

        sheet_result = await db.execute(
            select(AutoSpySheet).where(AutoSpySheet.project_id == source.project_id)
        )
        sheet = sheet_result.scalar_one_or_none()

        workbook = _load_workbook(sheet.data if sheet else None)
        workbook = _append_rows_to_tab(workbook, source.sheet_tab_id, rows)

        now = datetime.now(timezone.utc)
        if sheet is None:
            sheet = AutoSpySheet(
                project_id=source.project_id,
                data=_save_workbook(workbook),
                updated_at=now,
            )
            db.add(sheet)
        else:
            sheet.data = _save_workbook(workbook)
            sheet.updated_at = now

        source.last_scanned_at = now
        source.next_scan_at = now + timedelta(hours=24)
        await db.commit()


async def run_auto_spy_scheduler(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        now = datetime.now(timezone.utc)
        async with SessionLocal() as db:
            result = await db.execute(
                select(AutoSpySource).where(
                    AutoSpySource.next_scan_at.isnot(None),
                    AutoSpySource.next_scan_at <= now,
                )
            )
            due = result.scalars().all()
            source_ids = [s.id for s in due]

        for sid in source_ids:
            try:
                await scan_source(sid)
            except Exception:
                pass

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=60)
        except asyncio.TimeoutError:
            pass
