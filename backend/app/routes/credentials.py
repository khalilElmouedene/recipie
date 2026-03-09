from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..crypto import encrypt, decrypt
from ..database import get_db
from ..db_models import User, Project, ProjectCredential, ProjectMemberRole
from ..dependencies import get_current_user, check_project_access
from ..models import CredentialSet, CredentialOut

router = APIRouter(prefix="/api/projects", tags=["credentials"])

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


@router.get("/{project_id}/credentials", response_model=list[CredentialOut])
async def list_credentials(
    project_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db, require_roles=[ProjectMemberRole.admin])
    result = await db.execute(
        select(ProjectCredential).where(ProjectCredential.project_id == project_id)
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


@router.put("/{project_id}/credentials", response_model=list[CredentialOut])
async def set_credentials(
    project_id: uuid.UUID,
    body: list[CredentialSet],
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await check_project_access(project_id, user, db, require_roles=[ProjectMemberRole.admin])

    prj = await db.execute(select(Project).where(Project.id == project_id))
    if not prj.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Project not found")

    out = []
    for item in body:
        if item.key_type not in VALID_KEY_TYPES:
            raise HTTPException(status_code=400, detail=f"Invalid key_type: {item.key_type}")

        result = await db.execute(
            select(ProjectCredential).where(
                ProjectCredential.project_id == project_id,
                ProjectCredential.key_type == item.key_type,
            )
        )
        cred = result.scalar_one_or_none()
        enc = encrypt(item.value.strip())
        if cred:
            cred.encrypted_value = enc
        else:
            cred = ProjectCredential(
                project_id=project_id,
                key_type=item.key_type,
                encrypted_value=enc,
            )
            db.add(cred)

    await db.commit()
    result = await db.execute(
        select(ProjectCredential).where(ProjectCredential.project_id == project_id)
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
