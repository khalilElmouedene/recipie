from __future__ import annotations

import asyncio
import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..crypto import decrypt, encrypt
from ..database import get_db
from ..db_models import User, UserCredential
from ..dependencies import get_current_user
from ..services.cloudflare_ai import KEY_TYPES, MODEL, generate_images, load_cloudflare_credentials, require_cloudflare_user

router = APIRouter(prefix="/api/cloudflare", tags=["cloudflare"])


class CloudflareConfig(BaseModel):
    account_id: str = Field(min_length=32, max_length=32)
    api_token: str = Field(default="", max_length=512)

    @field_validator("account_id")
    @classmethod
    def valid_account(cls, value: str) -> str:
        if not re.fullmatch(r"[0-9a-fA-F]{32}", value):
            raise ValueError("Account ID must contain exactly 32 hexadecimal characters")
        return value


@router.get("/config")
async def get_config(user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    require_cloudflare_user(user)
    rows = (await db.execute(select(UserCredential).where(
        UserCredential.user_id == user.id, UserCredential.key_type.in_(KEY_TYPES),
    ))).scalars().all()
    values = {row.key_type: decrypt(row.encrypted_value).strip() for row in rows}
    return {"account_id": values.get("cloudflare_account_id", ""),
            "token_configured": bool(values.get("cloudflare_api_token")), "model": MODEL}


@router.put("/config")
async def set_config(body: CloudflareConfig, user: Annotated[User, Depends(get_current_user)],
                     db: Annotated[AsyncSession, Depends(get_db)]):
    require_cloudflare_user(user)
    values = {"cloudflare_account_id": body.account_id, "cloudflare_api_token": body.api_token.strip()}
    for key, value in values.items():
        if not value:  # A blank token preserves the saved secret.
            continue
        row = (await db.execute(select(UserCredential).where(
            UserCredential.user_id == user.id, UserCredential.key_type == key,
        ))).scalar_one_or_none()
        if row:
            row.encrypted_value = encrypt(value)
        else:
            db.add(UserCredential(user_id=user.id, key_type=key, encrypted_value=encrypt(value)))
    await db.commit()
    return await get_config(user, db)


@router.post("/test")
async def test_connection(user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    require_cloudflare_user(user)
    try:
        credentials = await load_cloudflare_credentials(db, user.id)
        images = await asyncio.to_thread(generate_images, "A bowl of homemade tomato soup with fresh basil",
                                         credentials, count=1, log=lambda _: None)
        return {"image_url": images[0], "model": MODEL}
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from None
