"""Paramètres / Settings - clés API globales, prompts (par owner)."""
from __future__ import annotations
import io
import json
import uuid
from typing import Annotated

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..crypto import encrypt, decrypt
from ..database import get_db
from ..db_models import User, UserCredential, Prompt, UserRole
from ..dependencies import get_current_user, require_owner
from ..models import CredentialSet, CredentialOut, PromptOut, PromptsUpdate
from ..services.prompts import DEFAULT_PROMPTS

router = APIRouter(prefix="/api/settings", tags=["settings"])

VALID_KEY_TYPES = {
    "openai",
    "discord_auth",
    "discord_app_id",
    "discord_guild",
    "discord_channel",
    "mj_version",
    "mj_id",
    "google_sa_json",
}


def _mask(value: str) -> str:
    if len(value) <= 8:
        return "****"
    return value[:4] + "****" + value[-4:]


async def _resolve_owner_id(user: User) -> uuid.UUID:
    """Return the effective owner_id for credentials/prompts lookup."""
    if user.role == UserRole.owner:
        return user.id
    if user.created_by_owner_id:
        return user.created_by_owner_id
    raise HTTPException(status_code=403, detail="No owner associated with this account")


@router.get("/credentials", response_model=list[CredentialOut])
async def list_user_credentials(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    owner_id = await _resolve_owner_id(user)
    result = await db.execute(
        select(UserCredential).where(UserCredential.user_id == owner_id)
    )
    creds = result.scalars().all()
    out = []
    for c in creds:
        try:
            plain = decrypt(c.encrypted_value)
        except Exception:
            plain = "****"
        out.append(CredentialOut(key_type=c.key_type, masked_value=_mask(plain), updated_at=c.updated_at))
    return out


@router.put("/credentials", response_model=list[CredentialOut])
async def set_user_credentials(
    body: list[CredentialSet],
    user: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    for item in body:
        if item.key_type not in VALID_KEY_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid key_type: {item.key_type}")
        result = await db.execute(
            select(UserCredential).where(
                UserCredential.user_id == user.id,
                UserCredential.key_type == item.key_type,
            )
        )
        cred = result.scalar_one_or_none()
        enc = encrypt(item.value.strip())
        if cred:
            cred.encrypted_value = enc
        else:
            cred = UserCredential(
                user_id=user.id,
                key_type=item.key_type,
                encrypted_value=enc,
            )
            db.add(cred)

    await db.commit()
    result = await db.execute(
        select(UserCredential).where(UserCredential.user_id == user.id)
    )
    creds = result.scalars().all()
    return [
        CredentialOut(
            key_type=c.key_type,
            masked_value=_mask(decrypt(c.encrypted_value)) if c.encrypted_value else "****",
            updated_at=c.updated_at,
        )
        for c in creds
    ]


@router.get("/prompts", response_model=list[PromptOut])
async def list_prompts(
    user: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: uuid.UUID = Query(...),
):
    result = await db.execute(
        select(Prompt).where(Prompt.owner_id == user.id, Prompt.project_id == project_id)
    )
    rows = result.scalars().all()
    out = {r.key: PromptOut(key=r.key, value=r.value, description=r.description or "") for r in rows}
    for key, data in DEFAULT_PROMPTS.items():
        if key not in out:
            out[key] = PromptOut(key=key, value=data["value"], description=data.get("description", ""))
    return list(out.values())


@router.put("/prompts", response_model=list[PromptOut])
async def update_prompts(
    body: PromptsUpdate,
    user: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
    project_id: uuid.UUID = Query(...),
):
    for key, value in body.prompts.items():
        if key not in DEFAULT_PROMPTS:
            raise HTTPException(status_code=400, detail=f"Invalid prompt key: {key}")
        result = await db.execute(
            select(Prompt).where(
                Prompt.owner_id == user.id,
                Prompt.project_id == project_id,
                Prompt.key == key,
            )
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = value
        else:
            db.add(Prompt(
                owner_id=user.id,
                project_id=project_id,
                key=key,
                value=value,
                description=DEFAULT_PROMPTS[key].get("description", ""),
            ))
    await db.commit()
    result = await db.execute(
        select(Prompt).where(Prompt.owner_id == user.id, Prompt.project_id == project_id)
    )
    rows = result.scalars().all()
    out = {r.key: PromptOut(key=r.key, value=r.value, description=r.description or "") for r in rows}
    for key, data in DEFAULT_PROMPTS.items():
        if key not in out:
            out[key] = PromptOut(key=key, value=data["value"], description=data.get("description", ""))
    return list(out.values())


# ── Pinterest Boards ─────────────────────────────────────────────────────────

_DEFAULT_BOARDS = DEFAULT_PROMPTS["pinterest_boards_list"]["value"].splitlines()


@router.post("/boards/import", response_model=dict)
async def import_boards_excel(
    user: Annotated[User, Depends(require_owner)],
    file: UploadFile = File(...),
):
    """Parse an Excel file (column A = board name, row 1 = header) and return newline-separated boards."""
    _MAX_EXCEL_BYTES = 5 * 1024 * 1024  # 5 MB
    content = await file.read()
    if len(content) > _MAX_EXCEL_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 5 MB size limit")
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid Excel file")
    ws = wb.active
    boards = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        cell = row[0] if row else None
        if cell:
            name = str(cell).strip()
            if name:
                boards.append(name)
    if not boards:
        raise HTTPException(status_code=400, detail="No board names found in column A (starting from row 2)")
    return {"boards": "\n".join(boards)}


@router.get("/boards/template")
async def get_boards_template(
    user: Annotated[User, Depends(require_owner)],
):
    """Return an Excel template pre-filled with the default Pinterest boards."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Boards"
    ws.column_dimensions["A"].width = 40
    ws.append(["Board Name"])
    for board in _DEFAULT_BOARDS:
        ws.append([board])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=pinterest_boards_template.xlsx"},
    )


# ── Midjourney generation timers (project owner account) ───────────────────


class MidjourneyTimersOut(BaseModel):
    grid_wait_seconds: int
    upscale_gap_seconds: int
    post_upscale_wait_seconds: int


class MidjourneyTimersUpdate(BaseModel):
    grid_wait_seconds: int
    upscale_gap_seconds: int
    post_upscale_wait_seconds: int


def _default_mj_timers() -> MidjourneyTimersOut:
    return MidjourneyTimersOut(grid_wait_seconds=190, upscale_gap_seconds=10, post_upscale_wait_seconds=60)


def _clamp_mj_timers(body: MidjourneyTimersUpdate) -> MidjourneyTimersOut:
    return MidjourneyTimersOut(
        grid_wait_seconds=max(30, min(600, body.grid_wait_seconds)),
        upscale_gap_seconds=max(1, min(120, body.upscale_gap_seconds)),
        post_upscale_wait_seconds=max(10, min(600, body.post_upscale_wait_seconds)),
    )


def _parse_timers_json(raw: str | None) -> MidjourneyTimersOut:
    if not raw:
        return _default_mj_timers()
    try:
        j = json.loads(raw)
        return _clamp_mj_timers(
            MidjourneyTimersUpdate(
                grid_wait_seconds=int(j.get("grid_wait_seconds", 190)),
                upscale_gap_seconds=int(j.get("upscale_gap_seconds", 10)),
                post_upscale_wait_seconds=int(j.get("post_upscale_wait_seconds", 60)),
            )
        )
    except (ValueError, TypeError, json.JSONDecodeError):
        return _default_mj_timers()


@router.get("/midjourney-timers", response_model=MidjourneyTimersOut)
async def get_midjourney_timers(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    owner_id = await _resolve_owner_id(user)
    result = await db.execute(select(User).where(User.id == owner_id))
    owner = result.scalar_one_or_none()
    if not owner:
        return _default_mj_timers()
    return _parse_timers_json(owner.mj_timer_settings)


@router.put("/midjourney-timers", response_model=MidjourneyTimersOut)
async def set_midjourney_timers(
    body: MidjourneyTimersUpdate,
    user: Annotated[User, Depends(require_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    out = _clamp_mj_timers(body)
    user.mj_timer_settings = json.dumps({
        "grid_wait_seconds": out.grid_wait_seconds,
        "upscale_gap_seconds": out.upscale_gap_seconds,
        "post_upscale_wait_seconds": out.post_upscale_wait_seconds,
    })
    await db.commit()
    return out


# ── Custom Fonts (per user) ──────────────────────────────────────────────────


class FontsUpdate(BaseModel):
    fonts: list[str]


@router.get("/fonts", response_model=list[str])
async def get_fonts(
    user: Annotated[User, Depends(get_current_user)],
):
    if not user.custom_fonts:
        return []
    try:
        return json.loads(user.custom_fonts)
    except (json.JSONDecodeError, TypeError):
        return []


@router.put("/fonts", response_model=list[str])
async def set_fonts(
    body: FontsUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    unique = list(dict.fromkeys(f.strip() for f in body.fonts if f.strip()))
    user.custom_fonts = json.dumps(unique)
    await db.commit()
    return unique
