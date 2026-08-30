from __future__ import annotations

import asyncio
import io
import logging
import os
import re
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import SessionLocal, get_db
from ..db_models import ImageBatch, ImageGeneration, Project, ProjectMember, User
from ..dependencies import check_project_access, get_current_user
from ..models import (
    ImageBatchCreate,
    ImageBatchDetailOut,
    ImageBatchOut,
    ImageGenerationOut,
    ImageProjectOut,
)
from ..services.article_generator import generate_direct_midjourney_images
from ..services.credentials_loader import load_credentials_for_job

router = APIRouter(prefix="/api/images", tags=["images"])
logger = logging.getLogger(__name__)
_batch_tasks: dict[str, asyncio.Task] = {}
UPLOADS_ROOT = Path(os.getenv("UPLOADS_DIR", "/app/uploads")).resolve()


def _require_khalil(user: User) -> None:
    if (user.email or "").strip().lower() != "khalil@gmail.com":
        raise HTTPException(status_code=403, detail="The image workspace is not available for this account")


def _project_out(project: Project, credentials: dict[str, str]) -> ImageProjectOut:
    return ImageProjectOut(
        id=project.id,
        name=project.name,
        description=project.description,
        midjourney_configured=bool(
            credentials.get("discord_auth")
            and credentials.get("discord_app_id")
            and credentials.get("discord_guild")
            and credentials.get("discord_channel")
            and credentials.get("mj_version")
            and credentials.get("mj_id")
        ),
        grid_wait_seconds=int(credentials.get("mj_grid_wait_seconds") or 600),
    )


def _batch_out(batch: ImageBatch) -> ImageBatchOut:
    return ImageBatchOut.model_validate(batch, from_attributes=True)


def _generation_out(generation: ImageGeneration) -> ImageGenerationOut:
    return ImageGenerationOut(
        id=generation.id,
        position=generation.position,
        prompt=generation.prompt,
        status=generation.status,
        image_urls=[str(url) for url in (generation.image_urls or [])],
        error=generation.error,
        created_at=generation.created_at,
    )


async def _run_batch(batch_id: uuid.UUID, credentials: dict[str, str]) -> None:
    batch_key = str(batch_id)
    try:
        async with SessionLocal() as db:
            batch = (await db.execute(select(ImageBatch).where(ImageBatch.id == batch_id))).scalar_one_or_none()
            generations = list((await db.execute(
                select(ImageGeneration).where(ImageGeneration.batch_id == batch_id).order_by(ImageGeneration.position)
            )).scalars().all())
            if not batch:
                return
            batch.status = "running"
            await db.commit()

        successful_prompts = 0
        failed_prompts = 0
        for generation in generations:
            async with SessionLocal() as db:
                await db.execute(
                    ImageGeneration.__table__.update()
                    .where(ImageGeneration.id == generation.id)
                    .values(status="generating", error=None)
                )
                await db.commit()

            try:
                urls = await asyncio.to_thread(
                    generate_direct_midjourney_images,
                    generation.prompt,
                    credentials,
                    lambda message: logger.info("Image batch %s: %s", batch_id, message),
                )
                successful_prompts += 1
                async with SessionLocal() as db:
                    await db.execute(
                        ImageGeneration.__table__.update()
                        .where(ImageGeneration.id == generation.id)
                        .values(status="completed", image_urls=urls, error=None)
                    )
                    await db.execute(
                        ImageBatch.__table__.update()
                        .where(ImageBatch.id == batch_id)
                        .values(
                            completed_prompts=ImageBatch.completed_prompts + 1,
                            total_images=ImageBatch.total_images + len(urls),
                        )
                    )
                    await db.commit()
            except Exception as exc:
                failed_prompts += 1
                logger.exception("Image batch %s prompt %s failed", batch_id, generation.position)
                async with SessionLocal() as db:
                    await db.execute(
                        ImageGeneration.__table__.update()
                        .where(ImageGeneration.id == generation.id)
                        .values(status="failed", error=str(exc))
                    )
                    await db.execute(
                        ImageBatch.__table__.update()
                        .where(ImageBatch.id == batch_id)
                        .values(completed_prompts=ImageBatch.completed_prompts + 1)
                    )
                    await db.commit()

        async with SessionLocal() as db:
            final_status = "failed" if successful_prompts == 0 else "completed"
            final_error = f"{failed_prompts} prompt(s) failed" if failed_prompts else None
            await db.execute(
                ImageBatch.__table__.update()
                .where(ImageBatch.id == batch_id)
                .values(status=final_status, error=final_error)
            )
            await db.commit()
    except asyncio.CancelledError:
        async with SessionLocal() as db:
            await db.execute(
                ImageBatch.__table__.update()
                .where(ImageBatch.id == batch_id)
                .values(status="stopped", error="Generation stopped by user")
            )
            await db.commit()
        raise
    except Exception:
        logger.exception("Image batch %s crashed", batch_id)
        async with SessionLocal() as db:
            await db.execute(
                ImageBatch.__table__.update()
                .where(ImageBatch.id == batch_id)
                .values(status="failed", error="The image batch stopped unexpectedly")
            )
            await db.commit()
    finally:
        _batch_tasks.pop(batch_key, None)
        async with SessionLocal() as db:
            await db.execute(
                ImageBatch.__table__.update()
                .where(ImageBatch.id == batch_id, ImageBatch.finished_at.is_(None))
                .values(finished_at=datetime.now(timezone.utc))
            )
            await db.commit()


@router.get("/projects", response_model=list[ImageProjectOut])
async def list_image_projects(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _require_khalil(user)
    stmt = select(Project).where(
        (Project.owner_id == user.id)
        | Project.id.in_(select(ProjectMember.project_id).where(ProjectMember.user_id == user.id))
    ).order_by(Project.created_at.desc())
    projects = list((await db.execute(stmt)).scalars().all())
    output: list[ImageProjectOut] = []
    for project in projects:
        credentials = await load_credentials_for_job(db, project.id, user.id)
        output.append(_project_out(project, credentials))
    return output


@router.post("/batches", response_model=ImageBatchOut, status_code=status.HTTP_201_CREATED)
async def create_image_batch(
    body: ImageBatchCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _require_khalil(user)
    await check_project_access(body.project_id, user, db)
    credentials = await load_credentials_for_job(db, body.project_id, user.id)
    required = ("discord_auth", "discord_app_id", "discord_guild", "discord_channel", "mj_version", "mj_id")
    if any(not credentials.get(key) for key in required):
        raise HTTPException(status_code=400, detail="Complete the Midjourney credentials in the selected project first")

    batch = ImageBatch(
        project_id=body.project_id,
        created_by=user.id,
        status="pending",
        total_prompts=len(body.prompts),
    )
    db.add(batch)
    await db.flush()
    for position, prompt in enumerate(body.prompts):
        db.add(ImageGeneration(batch_id=batch.id, position=position, prompt=prompt, status="pending"))
    await db.commit()
    row = (await db.execute(select(ImageBatch).where(ImageBatch.id == batch.id))).scalar_one()
    task = asyncio.create_task(_run_batch(batch.id, credentials))
    _batch_tasks[str(batch.id)] = task
    return row


@router.get("/batches", response_model=list[ImageBatchOut])
async def list_image_batches(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=12, ge=1, le=50),
):
    _require_khalil(user)
    if project_id:
        await check_project_access(project_id, user, db)
    stmt = select(ImageBatch).order_by(ImageBatch.created_at.desc())
    if project_id:
        stmt = stmt.where(ImageBatch.project_id == project_id)
    stmt = stmt.limit(limit)
    return list((await db.execute(stmt)).scalars().all())


@router.get("/batches/{batch_id}", response_model=ImageBatchDetailOut)
async def get_image_batch(
    batch_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _require_khalil(user)
    row = (await db.execute(select(ImageBatch).where(ImageBatch.id == batch_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Image batch not found")
    await check_project_access(row.project_id, user, db)
    generations = list((await db.execute(
        select(ImageGeneration).where(ImageGeneration.batch_id == batch_id).order_by(ImageGeneration.position)
    )).scalars().all())
    return ImageBatchDetailOut(
        **_batch_out(row).model_dump(),
        generations=[_generation_out(generation) for generation in generations],
    )


@router.post("/batches/{batch_id}/stop", response_model=ImageBatchOut)
async def stop_image_batch(
    batch_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _require_khalil(user)
    row = (await db.execute(select(ImageBatch).where(ImageBatch.id == batch_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Image batch not found")
    await check_project_access(row.project_id, user, db)
    task = _batch_tasks.get(str(batch_id))
    if task and not task.done():
        task.cancel()
    row.status = "stopped"
    row.error = "Generation stopped by user"
    await db.commit()
    return row


def _local_upload_path(url: str) -> Path | None:
    filename = Path(urlparse(url).path).name
    if not filename:
        return None
    candidate = (UPLOADS_ROOT / filename).resolve()
    if candidate.parent != UPLOADS_ROOT or not candidate.is_file():
        return None
    return candidate


def _safe_zip_part(value: str, fallback: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", value).strip("-")[:55]
    return safe or fallback


@router.get("/batches/{batch_id}/download")
async def download_image_batch(
    batch_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _require_khalil(user)
    row = (await db.execute(select(ImageBatch).where(ImageBatch.id == batch_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Image batch not found")
    await check_project_access(row.project_id, user, db)
    generations = list((await db.execute(
        select(ImageGeneration).where(ImageGeneration.batch_id == batch_id).order_by(ImageGeneration.position)
    )).scalars().all())
    if not any(g.image_urls for g in generations):
        raise HTTPException(status_code=409, detail="No generated images are available yet")

    archive = io.BytesIO()
    manifest: list[str] = [f"Imges batch {batch_id}", ""]
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
        for generation in generations:
            prompt_name = _safe_zip_part(generation.prompt, f"prompt-{generation.position + 1}")
            manifest.append(f"Prompt {generation.position + 1}: {generation.prompt}")
            for image_index, url in enumerate(generation.image_urls or [], start=1):
                source = _local_upload_path(str(url))
                if not source:
                    manifest.append(f"Missing cached file: {url}")
                    continue
                zipped.write(source, f"{generation.position + 1:02d}-{prompt_name}/{image_index:02d}{source.suffix.lower() or '.bin'}")
        zipped.writestr("prompts.txt", "\n".join(manifest) + "\n")

    filename = f"imges-{batch_id.hex[:8]}.zip"
    return Response(
        content=archive.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
