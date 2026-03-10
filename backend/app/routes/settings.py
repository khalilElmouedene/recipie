"""Paramètres / Settings - clés API globales, prompts (par owner)."""
from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
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
):
    result = await db.execute(
        select(Prompt).where(Prompt.owner_id == user.id)
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
):
    for key, value in body.prompts.items():
        if key not in DEFAULT_PROMPTS:
            raise HTTPException(status_code=400, detail=f"Invalid prompt key: {key}")
        result = await db.execute(
            select(Prompt).where(Prompt.owner_id == user.id, Prompt.key == key)
        )
        row = result.scalar_one_or_none()
        if row:
            row.value = value
        else:
            db.add(Prompt(
                owner_id=user.id,
                key=key,
                value=value,
                description=DEFAULT_PROMPTS[key].get("description", ""),
            ))
    await db.commit()
    result = await db.execute(
        select(Prompt).where(Prompt.owner_id == user.id)
    )
    rows = result.scalars().all()
    out = {r.key: PromptOut(key=r.key, value=r.value, description=r.description or "") for r in rows}
    for key, data in DEFAULT_PROMPTS.items():
        if key not in out:
            out[key] = PromptOut(key=key, value=data["value"], description=data.get("description", ""))
    return list(out.values())
