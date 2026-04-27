"""
Standalone runner for the `auto_spy_generate` job type.

This module is intentionally separate from the existing articles / publisher /
articles_all_sites flows so that changes here cannot affect those pipelines.

Flow:
  1. Distribute selected (image_url, recipe_text) pairs across all project sites
     (same fan-out as articles_all_sites).
  2. Generate articles for each recipe using article_generator.generate_for_recipe.
  3. Render a pin image for each recipe using the site's configured pin_template_id.
  4. After everything is done, upsert ProjectPublishSchedule so the publish
     scheduler picks up the generated recipes automatically.
"""
from __future__ import annotations

import asyncio
import base64
import json
import threading
import uuid
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Callable

from sqlalchemy import select, update

from ..database import SessionLocal
from ..db_models import (
    Job as JobModel,
    JobLog,
    JobStatus,
    JobType,
    PinDesignerTemplate,
    ProjectPublishSchedule,
    Recipe,
    RecipeStatus,
    Site,
    SitePublishSchedule,
)


# ── Pin image rendering ────────────────────────────────────────────────────────

def _render_pin_for_recipe(
    image_url: str,
    title: str,
    pin_template_id: str | None,
    site_domain: str,
    log: Callable[[str], None],
) -> str | None:
    """Return a base64 data-URI for the pin image, or None on failure."""
    from ..services.pin_generator import generate_pin_base64, TEMPLATES

    try:
        if pin_template_id and pin_template_id in TEMPLATES:
            # Built-in template
            b64 = generate_pin_base64(
                template_id=pin_template_id,
                image_urls=[image_url],
                title=title,
                website=site_domain,
            )
            return b64

        if pin_template_id:
            # Try to load as a custom DB template and render with PIL
            b64 = _render_custom_template_sync(pin_template_id, image_url, title, site_domain, log)
            if b64:
                return b64

        # Fallback: modern_split built-in
        b64 = generate_pin_base64(
            template_id="modern_split",
            image_urls=[image_url],
            title=title,
            website=site_domain,
        )
        return b64
    except Exception as exc:
        log(f"Pin rendering failed (non-fatal): {exc}")
        return None


def _render_custom_template_sync(
    template_id: str,
    image_url: str,
    title: str,
    site_domain: str,
    log: Callable[[str], None],
) -> str | None:
    """Render a PinDesignerTemplate stored in the DB using PIL."""
    import asyncio as _asyncio

    async def _load():
        async with SessionLocal() as session:
            try:
                row = await session.execute(
                    select(PinDesignerTemplate).where(
                        PinDesignerTemplate.id == uuid.UUID(template_id)
                    )
                )
                return row.scalar_one_or_none()
            except Exception:
                return None

    # We're inside a background thread, so use asyncio.run for a one-shot DB lookup.
    try:
        tmpl = _asyncio.run(_load())
    except Exception:
        return None

    if tmpl is None:
        return None

    try:
        elements = json.loads(tmpl.elements_json) if tmpl.elements_json else []
    except Exception:
        elements = []

    return _pil_render_elements(
        elements=elements,
        bg_color=tmpl.bg_color or "#ffffff",
        canvas_width=tmpl.canvas_width or 1000,
        canvas_height=tmpl.canvas_height or 1500,
        image_url=image_url,
        title=title,
        site_domain=site_domain,
        log=log,
    )


def _parse_hex_color(color: str, opacity: float = 1.0) -> tuple:
    """Parse a CSS hex or rgb color into an RGBA tuple."""
    color = (color or "#888888").strip()
    a = max(0, min(255, int(opacity * 255)))
    try:
        if color.startswith("#"):
            h = color.lstrip("#")
            if len(h) == 3:
                h = h[0]*2 + h[1]*2 + h[2]*2
            r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            return (r, g, b, a)
        if color.startswith("rgb"):
            parts = color.replace("rgba(", "").replace("rgb(", "").replace(")", "")
            nums = [float(x.strip()) for x in parts.split(",")]
            r, g, b = int(nums[0]), int(nums[1]), int(nums[2])
            return (r, g, b, a)
    except Exception:
        pass
    return (136, 136, 136, a)


def _pil_render_elements(
    elements: list[dict],
    bg_color: str,
    canvas_width: int,
    canvas_height: int,
    image_url: str,
    title: str,
    site_domain: str,
    log: Callable[[str], None],
) -> str | None:
    try:
        from PIL import Image, ImageDraw
        from ..services.pin_generator import _download, _fit_crop, _font, _wrap_draw, _placeholder
    except Exception as exc:
        log(f"PIL import failed: {exc}")
        return None

    try:
        bg_rgba = _parse_hex_color(bg_color)
        canvas = Image.new("RGBA", (canvas_width, canvas_height), bg_rgba[:3])
        draw = ImageDraw.Draw(canvas)

        food_img: Image.Image | None = None

        def _get_food_img() -> Image.Image:
            nonlocal food_img
            if food_img is None:
                try:
                    food_img = _download(image_url)
                except Exception:
                    food_img = _placeholder(400, 600)
            return food_img

        for elem in elements:
            pin_type = str(elem.get("__pinType") or elem.get("type") or "")
            opacity = float(elem.get("opacity", 1.0))
            left = int(float(elem.get("left", 0)))
            top = int(float(elem.get("top", 0)))
            sx = float(elem.get("scaleX", 1.0))
            sy = float(elem.get("scaleY", 1.0))
            w = max(1, int(float(elem.get("width", 100)) * sx))
            h = max(1, int(float(elem.get("height", 100)) * sy))

            if pin_type in ("band", "rect"):
                fill = _parse_hex_color(str(elem.get("fill") or "#888888"), opacity)
                # Use a temporary RGBA image for proper opacity compositing
                band = Image.new("RGBA", (w, h), fill)
                canvas.paste(band, (left, top), band)

            elif pin_type == "frame":
                stroke = _parse_hex_color(str(elem.get("stroke") or "#ffffff"), opacity)
                sw = max(1, int(float(elem.get("strokeWidth", 2))))
                draw2 = ImageDraw.Draw(canvas)
                draw2.rectangle([left, top, left + w, top + h], outline=stroke, width=sw)

            elif pin_type == "image":
                clip = elem.get("__clipZone")
                if clip and isinstance(clip, dict):
                    cw = max(1, int(float(clip.get("width", w))))
                    ch = max(1, int(float(clip.get("height", h))))
                    cl = left + int(float(clip.get("left", 0)))
                    ct = top + int(float(clip.get("top", 0)))
                else:
                    cw, ch, cl, ct = w, h, left, top
                cropped = _fit_crop(_get_food_img(), cw, ch).convert("RGBA")
                canvas.paste(cropped, (cl, ct))

            elif pin_type == "text":
                raw_text = str(elem.get("text") or "")
                # If text looks like a placeholder/empty, substitute title
                display = raw_text if raw_text and not raw_text.startswith("{{") else title
                if not display:
                    continue
                fill_color = str(elem.get("fill") or "#ffffff")
                font_size = max(8, int(float(elem.get("fontSize", 36)) * min(sx, sy)))
                bold = str(elem.get("fontWeight", "")).lower() == "bold"
                align = str(elem.get("textAlign", "left")).lower()
                if align not in ("left", "center", "right"):
                    align = "left"
                _wrap_draw(draw, display, left, top, max(1, w), _font(font_size, bold), fill_color, align=align)

        buf = BytesIO()
        canvas.convert("RGB").save(buf, format="JPEG", quality=88)
        b64 = base64.b64encode(buf.getvalue()).decode()
        return f"data:image/jpeg;base64,{b64}"
    except Exception as exc:
        log(f"Custom template rendering error: {exc}")
        return None


# ── DB helpers (called from background thread via run_coroutine_threadsafe) ────

async def _db_update_recipe(recipe_id: str, fields: dict) -> None:
    async with SessionLocal() as session:
        row = await session.execute(select(Recipe).where(Recipe.id == uuid.UUID(recipe_id)))
        recipe = row.scalar_one_or_none()
        if not recipe:
            return
        for key, val in fields.items():
            if not hasattr(recipe, key) or val is None:
                continue
            if key == "pin_blog_link" and getattr(recipe, "pin_blog_link", None):
                continue
            setattr(recipe, key, val)
        if fields.get("error_message"):
            recipe.status = RecipeStatus.failed
        else:
            recipe.status = RecipeStatus.generated
            recipe.error_message = None
        await session.commit()


async def _db_set_job_status(
    job_id_str: str,
    status: JobStatus,
    total_rows: int | None = None,
    error: str | None = None,
) -> None:
    async with SessionLocal() as session:
        row = await session.execute(select(JobModel).where(JobModel.id == uuid.UUID(job_id_str)))
        job = row.scalar_one_or_none()
        if job:
            job.status = status
            if total_rows is not None:
                job.total_rows = total_rows
            if error is not None:
                job.error = error
                job.finished_at = datetime.now(timezone.utc)
            await session.commit()


async def _db_persist_progress(job_id_str: str, current: int, total: int) -> None:
    async with SessionLocal() as session:
        row = await session.execute(select(JobModel).where(JobModel.id == uuid.UUID(job_id_str)))
        job = row.scalar_one_or_none()
        if job:
            job.current_row = current
            job.total_rows = total
            await session.commit()


async def _db_persist_final(
    job_id_str: str,
    final_status: JobStatus,
    logs: list[str],
    error: str | None,
) -> None:
    async with SessionLocal() as session:
        row = await session.execute(select(JobModel).where(JobModel.id == uuid.UUID(job_id_str)))
        job = row.scalar_one_or_none()
        if job:
            if job.status == JobStatus.stopped:
                final_status = JobStatus.stopped
            job.status = final_status
            job.finished_at = datetime.now(timezone.utc)
            if error and final_status != JobStatus.stopped:
                job.error = error
            for msg in logs:
                session.add(JobLog(job_id=job.id, message=msg))
            await session.commit()


async def _db_revert_generating(recipe_ids: list[str]) -> None:
    async with SessionLocal() as session:
        await session.execute(
            update(Recipe)
            .where(
                Recipe.id.in_([uuid.UUID(rid) for rid in recipe_ids]),
                Recipe.status == RecipeStatus.generating,
            )
            .values(status=RecipeStatus.pending)
        )
        await session.commit()


async def _db_upsert_site_schedules(
    site_schedules: list[dict],
) -> None:
    """Upsert per-site publish schedules for auto_spy_generate jobs."""
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        for ss in site_schedules:
            row = await session.execute(
                select(SitePublishSchedule).where(
                    SitePublishSchedule.site_id == ss["site_id"]
                )
            )
            schedule = row.scalar_one_or_none()
            if schedule is None:
                schedule = SitePublishSchedule(
                    site_id=ss["site_id"],
                    enabled=True,
                    interval_minutes=ss["interval_minutes"],
                    next_run_at=ss["publish_start_at"],
                    updated_at=now,
                )
                session.add(schedule)
            else:
                schedule.enabled = True
                schedule.interval_minutes = ss["interval_minutes"]
                schedule.next_run_at = ss["publish_start_at"]
                schedule.updated_at = now
        await session.commit()


# ── Public entry point ─────────────────────────────────────────────────────────

async def start_auto_spy_generate_job(
    db_job: JobModel,
    shared_recipes: list[Any],
    site_schedules: list[dict],  # [{site_id, publish_start_at, interval_minutes}, ...]
    credentials: dict,
    prompts: dict[str, str],
    sites: list[Site],
    running_jobs: dict,          # job_manager._running
    main_loop: asyncio.AbstractEventLoop,
) -> None:
    """
    Create Recipe rows, launch a background thread that generates articles + pin
    images, then enable per-site publish schedules when done.

    `running_jobs` is the shared dict from JobManager so the job is trackable
    (stop/log streaming) without modifying any existing code paths.
    """
    from ..workers.job_manager import RunningJob
    from ..services.article_generator import generate_for_recipe

    job_id_str = str(db_job.id)

    # ── Create Recipe records ──────────────────────────────────────────────────
    multi_site_groups: list[dict] = []
    created_recipe_ids: list[uuid.UUID] = []

    from ..database import SessionLocal as _SL
    async with _SL() as db:
        try:
            for idx, item in enumerate(shared_recipes):
                if isinstance(item, dict):
                    recipe_text = str(item.get("recipe_text", "")).strip()
                    image_url = str(item.get("image_url", "")).strip()
                else:
                    recipe_text = str(getattr(item, "recipe_text", "")).strip()
                    image_url = str(getattr(item, "image_url", "")).strip()

                if not recipe_text or not image_url:
                    continue

                group_items: list[dict] = []
                for s in sites:
                    new_recipe = Recipe(
                        site_id=s.id,
                        created_by=db_job.created_by,
                        created_by_job_id=db_job.id,
                        image_url=image_url,
                        recipe_text=recipe_text,
                        status=RecipeStatus.generating,
                    )
                    db.add(new_recipe)
                    await db.flush()
                    created_recipe_ids.append(new_recipe.id)
                    group_items.append({
                        "id": str(new_recipe.id),
                        "site_id": str(s.id),
                        "site_domain": s.domain,
                        "pinterest_url": s.pinterest_url or "",
                        "pin_template_id": s.pin_template_id,
                        "recipe_text": recipe_text,
                        "image_url": image_url,
                        "group_idx": idx + 1,
                    })
                if group_items:
                    multi_site_groups.append({
                        "idx": idx + 1,
                        "items": group_items,
                        "recipe_text": recipe_text,
                        "image_url": image_url,
                    })

            if not multi_site_groups:
                await db.commit()
                await _db_set_job_status(job_id_str, JobStatus.failed, error="No valid shared recipes to process")
                return

            recipes_data = [{"id": str(rid)} for rid in created_recipe_ids]
            await db.commit()
            await _db_set_job_status(job_id_str, JobStatus.running, total_rows=len(recipes_data))
        except Exception as exc:
            await db.rollback()
            await _db_set_job_status(job_id_str, JobStatus.failed, error=f"Failed to create recipes: {exc}")
            return

    # ── Launch background thread ───────────────────────────────────────────────
    from ..workers.job_manager import RunningJob
    rj = RunningJob(db_job.id)
    running_jobs[job_id_str] = rj

    def _run() -> None:
        total = len(recipes_data)
        done = 0

        def _on_recipe_done(recipe_id: str, fields: dict) -> None:
            asyncio.run_coroutine_threadsafe(
                _db_update_recipe(recipe_id, fields), main_loop
            ).result()

        def _on_progress(current: int, total_: int) -> None:
            rj.set_progress(current, total_)
            asyncio.run_coroutine_threadsafe(
                _db_persist_progress(job_id_str, current, total_), main_loop
            ).result()

        def _finalize(final_status: JobStatus, error: str | None = None) -> None:
            asyncio.run_coroutine_threadsafe(
                _db_persist_final(job_id_str, final_status, rj._logs, error), main_loop
            ).result()
            running_jobs.pop(job_id_str, None)

        def _revert() -> None:
            asyncio.run_coroutine_threadsafe(
                _db_revert_generating([r["id"] for r in recipes_data]), main_loop
            ).result()

        rj.log(f"Auto Spy Generate — {total} recipe(s) across {len(sites)} site(s)")

        try:
            for group in multi_site_groups:
                if rj.should_stop():
                    break
                items = group["items"]
                rj.log(f"Input recipe {group['idx']}: {group['recipe_text'][:60]}")

                for item in items:
                    if rj.should_stop():
                        break
                    rj.log("=" * 50)
                    rj.log(f"RECIPE {done + 1}/{total}: {item['recipe_text'][:60]}")
                    rj.log(f"  Site: {item['site_domain']}")
                    rj.log("=" * 50)

                    generated = generate_for_recipe(
                        recipe_id=item["id"],
                        recipe_text=item["recipe_text"],
                        image_url=item["image_url"],
                        site_domain=item["site_domain"],
                        credentials=credentials,
                        prompts=prompts,
                        log=rj.log,
                        should_stop=rj.should_stop,
                        pinterest_url=item.get("pinterest_url", ""),
                    )

                    if rj.should_stop():
                        break

                    if "error_message" not in generated or not generated.get("error_message"):
                        # Render pin image
                        pin_title = (
                            generated.get("pin_title")
                            or item["recipe_text"].splitlines()[0].strip()
                        )
                        pin_img = _render_pin_for_recipe(
                            image_url=item["image_url"],
                            title=pin_title,
                            pin_template_id=item.get("pin_template_id"),
                            site_domain=item["site_domain"],
                            log=rj.log,
                        )
                        if pin_img:
                            generated["pin_design_image"] = pin_img
                            generated["pin_template_id"] = item.get("pin_template_id")
                            rj.log("Pin image rendered successfully")

                    _on_recipe_done(item["id"], generated)
                    done += 1
                    _on_progress(done, total)

            if rj.should_stop():
                _revert()
                _finalize(JobStatus.stopped)
                return

            rj.log("All recipes generated. Enabling per-site publish schedules...")
            asyncio.run_coroutine_threadsafe(
                _db_upsert_site_schedules(site_schedules),
                main_loop,
            ).result()
            for ss in site_schedules:
                rj.log(f"Site schedule: site={ss['site_id']} every {ss['interval_minutes']} min starting {ss['publish_start_at'].isoformat()}")
            rj.log("Auto Spy Generate completed successfully")
            _finalize(JobStatus.completed)

        except Exception as exc:
            rj.log(f"Auto Spy Generate failed: {exc}")
            _revert()
            _finalize(JobStatus.failed, error=str(exc))

    thread = threading.Thread(target=_run, daemon=True)
    rj._thread = thread
    thread.start()


# ── Resume entry point ─────────────────────────────────────────────────────────

async def resume_auto_spy_generate_job(
    db_job: JobModel,
    credentials: dict,
    prompts: dict[str, str],
    running_jobs: dict,
    main_loop: asyncio.AbstractEventLoop,
) -> None:
    """Re-process pending recipes from a stopped/failed auto_spy_generate job."""
    from ..services.article_generator import generate_for_recipe

    job_id_str = str(db_job.id)

    # Load pending recipes with their sites
    async with SessionLocal() as db:
        pending_rows = await db.execute(
            select(Recipe, Site)
            .join(Site, Recipe.site_id == Site.id)
            .where(
                Recipe.created_by_job_id == db_job.id,
                Recipe.status == RecipeStatus.pending,
            )
            .order_by(Recipe.recipe_text, Site.created_at)
        )
        pending = pending_rows.all()

        if not pending:
            await _db_set_job_status(job_id_str, JobStatus.completed)
            return

        recipe_ids = [r.id for r, _ in pending]
        await db.execute(
            update(Recipe)
            .where(Recipe.id.in_(recipe_ids))
            .values(status=RecipeStatus.generating)
        )
        await db.commit()

        groups: dict[tuple, list[dict]] = {}
        for recipe, site in pending:
            key = (recipe.recipe_text, recipe.image_url)
            if key not in groups:
                groups[key] = []
            groups[key].append({
                "id": str(recipe.id),
                "site_domain": site.domain,
                "pinterest_url": site.pinterest_url or "",
                "pin_template_id": site.pin_template_id,
                "recipe_text": recipe.recipe_text,
                "image_url": recipe.image_url,
            })

        multi_site_groups = [
            {"idx": i + 1, "items": items, "recipe_text": rt, "image_url": iu}
            for i, ((rt, iu), items) in enumerate(groups.items())
        ]
        recipes_data = [{"id": str(r.id)} for r, _ in pending]

    await _db_set_job_status(job_id_str, JobStatus.running, total_rows=len(recipes_data))

    rj = RunningJob(db_job.id)
    running_jobs[job_id_str] = rj

    def _run() -> None:
        total = len(recipes_data)
        done = 0

        def _on_recipe_done(recipe_id: str, fields: dict) -> None:
            asyncio.run_coroutine_threadsafe(_db_update_recipe(recipe_id, fields), main_loop).result()

        def _on_progress(current: int, total_: int) -> None:
            rj.set_progress(current, total_)
            asyncio.run_coroutine_threadsafe(_db_persist_progress(job_id_str, current, total_), main_loop).result()

        def _finalize(final_status: JobStatus, error: str | None = None) -> None:
            asyncio.run_coroutine_threadsafe(_db_persist_final(job_id_str, final_status, rj._logs, error), main_loop).result()
            running_jobs.pop(job_id_str, None)

        def _revert() -> None:
            asyncio.run_coroutine_threadsafe(_db_revert_generating([r["id"] for r in recipes_data]), main_loop).result()

        rj.log(f"Resuming Auto Spy Generate — {total} recipe(s) remaining")

        try:
            for group in multi_site_groups:
                if rj.should_stop():
                    break
                items = group["items"]
                rj.log(f"Input recipe {group['idx']}: {group['recipe_text'][:60]}")

                for item in items:
                    if rj.should_stop():
                        break
                    rj.log("=" * 50)
                    rj.log(f"RECIPE {done + 1}/{total}: {item['recipe_text'][:60]}")
                    rj.log(f"  Site: {item['site_domain']}")
                    rj.log("=" * 50)

                    generated = generate_for_recipe(
                        recipe_id=item["id"],
                        recipe_text=item["recipe_text"],
                        image_url=item["image_url"],
                        site_domain=item["site_domain"],
                        credentials=credentials,
                        prompts=prompts,
                        log=rj.log,
                        should_stop=rj.should_stop,
                        pinterest_url=item.get("pinterest_url", ""),
                    )

                    if rj.should_stop():
                        break

                    if not generated.get("error_message"):
                        pin_title = generated.get("pin_title") or item["recipe_text"].splitlines()[0].strip()
                        pin_img = _render_pin_for_recipe(
                            image_url=item["image_url"],
                            title=pin_title,
                            pin_template_id=item.get("pin_template_id"),
                            site_domain=item["site_domain"],
                            log=rj.log,
                        )
                        if pin_img:
                            generated["pin_design_image"] = pin_img
                            generated["pin_template_id"] = item.get("pin_template_id")
                            rj.log("Pin image rendered successfully")

                    _on_recipe_done(item["id"], generated)
                    done += 1
                    _on_progress(done, total)

            if rj.should_stop():
                _revert()
                _finalize(JobStatus.stopped)
                return

            rj.log("Auto Spy Generate resumed and completed successfully")
            _finalize(JobStatus.completed)

        except Exception as exc:
            rj.log(f"Resume failed: {exc}")
            _revert()
            _finalize(JobStatus.failed, error=str(exc))

    thread = threading.Thread(target=_run, daemon=True)
    rj._thread = thread
    thread.start()
