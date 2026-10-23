"""Reclaim application-owned images only after all live database references disappear."""
from __future__ import annotations

import html
import json
import logging
import math
import os
import re
import shutil
import stat
import time
from pathlib import Path, PurePosixPath
from urllib.parse import unquote

from sqlalchemy import JSON, String, select, text

from app.database import Base, SessionLocal
from app import db_models  # Register all content, templates and media models.
from app import pinterest_models  # noqa: F401

logger = logging.getLogger(__name__)
UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", "/app/uploads"))
_HISTORY_TABLES = {
    "audit_logs", "job_logs", "facebook_generation_logs", "pinterest_publishing_logs",
}
_IMAGE_NAME = re.compile(r"(?:[a-f0-9]{32}|source_[a-f0-9]{64})\.[a-z0-9]{1,10}\Z")
_UPLOAD_PATH = re.compile(r"/uploads/([^\s\"'<>?#\\\[\]{},)]+)")
_GC_LOCK = 1782990412


def ensure_upload_capacity(size: int, root: Path | None = None) -> None:
    """Leave headroom for PostgreSQL and Docker instead of filling the root disk."""
    directory = root or UPLOADS_DIR
    directory.mkdir(parents=True, exist_ok=True)
    reserve = 512 * 1024**2
    if shutil.disk_usage(directory).free - size < reserve:
        raise OSError("Upload storage is nearly full; free disk space before generating or uploading more images")


def upload_keys(value, *, depth: int = 0) -> set[str]:
    """Understand nested JSON, escaped URLs and HTML without trusting URL hosts."""
    if depth > 12:
        raise ValueError("Upload reference JSON nesting is too deep to scan safely")
    if isinstance(value, dict):
        result: set[str] = set()
        for child in value.values():
            result.update(upload_keys(child, depth=depth + 1))
        return result
    if isinstance(value, (list, tuple)):
        result = set()
        for child in value:
            result.update(upload_keys(child, depth=depth + 1))
        return result
    if not isinstance(value, str):
        return set()
    stripped = value.lstrip()
    if stripped.startswith(("[", "{", '"')):
        try:
            decoded = json.loads(value)
        except (ValueError, TypeError):
            pass
        else:
            if decoded != value:
                return upload_keys(decoded, depth=depth + 1)
    normalized = value.replace("\\/", "/")
    for _ in range(3):
        decoded = html.unescape(unquote(normalized))
        if decoded == normalized:
            break
        normalized = decoded
    result = set()
    for key in _UPLOAD_PATH.findall(normalized):
        parts = PurePosixPath(key).parts
        if parts and ".." not in parts and not key.startswith("/"):
            result.add(PurePosixPath(key).as_posix())
    return result


def reference_tables():
    """Scan current content, including HTML/templates; historical logs are not owners."""
    return [
        (table, [column for column in table.columns
                 if isinstance(column.type, (String, JSON))])
        for table in Base.metadata.sorted_tables
        if table.name not in _HISTORY_TABLES
    ]


async def collect_upload_references(db) -> set[str]:
    references: set[str] = set()
    for table, columns in reference_tables():
        if not columns:
            continue
        # Scan full values: a LIKE filter can miss HTML entities or escaped JSON.
        # Stream rows so base64 template previews cannot inflate a full-table result.
        result = await db.stream(select(*columns).execution_options(yield_per=100))
        async for row in result:
            for value in row:
                references.update(upload_keys(value))
    return references


async def _lock_reference_tables(db) -> bool:
    if db.bind.dialect.name != "postgresql":
        return True  # Tests use a single SQLite writer.
    locked = (await db.execute(
        text("SELECT pg_try_advisory_xact_lock(:key)"), {"key": _GC_LOCK},
    )).scalar_one()
    if not locked:
        return False
    await db.execute(text("SET LOCAL lock_timeout = '5s'"))
    # Hold writers until scanning and unlinking finish, so a file cannot acquire a
    # new committed database reference between the check and its deletion.
    quote = db.bind.dialect.identifier_preparer.quote
    names = ", ".join(quote(table.name) for table, _ in sorted(reference_tables(), key=lambda item: item[0].name))
    await db.execute(text(f"LOCK TABLE {names} IN SHARE MODE"))
    return True


def _managed_images(root: Path, scope: str):
    # Only flat paths written by recipe source uploads and the article image cache.
    # Other directories (Facebook/Threads/cookies/custom assets) are never swept.
    directories = [root / "recipes"] if scope == "recipes" else [root, root / "recipes"]
    for directory in directories:
        if directory.is_symlink() or not directory.is_dir():
            continue
        with os.scandir(directory) as entries:
            for entry in entries:
                if _IMAGE_NAME.fullmatch(entry.name) and entry.is_file(follow_symlinks=False):
                    yield Path(entry.path)


def _selected_images(root: Path, keys: set[str]):
    for key in sorted(keys):
        parts = PurePosixPath(key).parts
        if (len(parts) == 1 or (len(parts) == 2 and parts[0] == "recipes")) and _IMAGE_NAME.fullmatch(parts[-1]):
            path = root.joinpath(*parts)
            if not path.parent.is_symlink():
                yield path


async def prune_orphan_uploads(
    *, dry_run: bool = True, min_age_hours: float = 48, limit: int = 2000,
    scope: str = "all", only_keys: set[str] | None = None,
) -> dict:
    """Default to a preview. Failed removals stay discoverable on the next pass."""
    if not math.isfinite(min_age_hours) or min_age_hours < 0 or limit < 0 or scope not in {"all", "recipes"}:
        raise ValueError("Invalid upload cleanup age, limit or scope")
    root = UPLOADS_DIR.resolve()
    result = dict(scanned=0, referenced=0, recent=0, candidates=0, candidate_bytes=0,
                  deleted=0, deleted_bytes=0, failed=0, busy=False, dry_run=dry_run)
    cutoff = time.time() - min_age_hours * 3600
    async with SessionLocal() as db:
        if not dry_run and not await _lock_reference_tables(db):
            result["busy"] = True
            return result
        references = await collect_upload_references(db)
        # A stored URL can refer to a symlink alias. Preserve its in-volume target too.
        canonical = set()
        for key in references:
            target = (root / key).resolve()
            if target.is_relative_to(root):
                canonical.add(target.relative_to(root).as_posix())
        references.update(canonical)
        paths = _managed_images(root, scope) if only_keys is None else _selected_images(root, only_keys)
        for path in paths:
            key = path.relative_to(root).as_posix()
            if only_keys is not None and key not in only_keys:
                continue
            try:
                before = path.lstat()
            except FileNotFoundError:
                continue
            if not stat.S_ISREG(before.st_mode):
                continue
            result["scanned"] += 1
            if key in references:
                result["referenced"] += 1
                continue
            if max(before.st_mtime, before.st_ctime) > cutoff:
                result["recent"] += 1
                continue
            allocated = getattr(before, "st_blocks", None)
            size = allocated * 512 if allocated is not None else before.st_size
            result["candidates"] += 1
            result["candidate_bytes"] += size
            if dry_run or (limit and result["deleted"] + result["failed"] >= limit):
                continue
            try:
                after = path.lstat()
                if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns, before.st_size) != (
                    after.st_dev, after.st_ino, after.st_mtime_ns, after.st_ctime_ns, after.st_size
                ):
                    continue
                if not path.resolve().is_relative_to(root) or not stat.S_ISREG(after.st_mode):
                    continue
                path.unlink()
                result["deleted"] += 1
                result["deleted_bytes"] += size
            except FileNotFoundError:
                continue
            except OSError:
                result["failed"] += 1
                logger.exception("Upload removal failed; will retry %s", key)
    logger.info("Upload storage cleanup: %s", result)
    return result


async def remove_unreferenced_files(paths: set[Path]) -> int:
    """After a DB commit, remove selected files only if no remaining owner needs them."""
    root = UPLOADS_DIR.resolve()
    keys = {p.resolve().relative_to(root).as_posix() for p in paths if p.resolve().is_relative_to(root)}
    if not keys:
        return 0
    result = await prune_orphan_uploads(dry_run=False, min_age_hours=0, limit=0, only_keys=keys)
    if result["failed"] or result["busy"]:
        raise OSError("Upload deletion incomplete; hourly orphan cleanup will retry")
    return result["deleted"]
