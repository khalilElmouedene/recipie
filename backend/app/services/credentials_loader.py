"""Shared credential loading for jobs - same logic as Paramètres/Settings."""
from __future__ import annotations
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..crypto import decrypt
from ..db_models import Project, ProjectCredential, ProjectMember, UserCredential


async def load_credentials_for_job(
    db: AsyncSession,
    project_id: uuid.UUID,
    created_by_user_id: uuid.UUID,
) -> dict[str, str]:
    """Load credentials for a job. Uses same decrypt as Settings/Paramètres.
    Priority: Project creds, then job creator, then owner, then members.
    """
    credentials: dict[str, str] = {}

    def _add_cred(key_type: str, encrypted_value: str) -> None:
        if key_type not in credentials:
            try:
                credentials[key_type] = decrypt(encrypted_value)
            except Exception:
                pass

    # 1. Project credentials
    proj_rows = await db.execute(
        select(ProjectCredential).where(ProjectCredential.project_id == project_id)
    )
    for c in proj_rows.scalars().all():
        _add_cred(c.key_type, c.encrypted_value)

    # 2. Job creator's user credentials (Paramètres)
    user_rows = await db.execute(
        select(UserCredential).where(UserCredential.user_id == created_by_user_id)
    )
    for c in user_rows.scalars().all():
        _add_cred(c.key_type, c.encrypted_value)

    # 3. Project owner fallback
    prj = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if prj and prj.owner_id != created_by_user_id:
        owner_rows = await db.execute(
            select(UserCredential).where(UserCredential.user_id == prj.owner_id)
        )
        for c in owner_rows.scalars().all():
            _add_cred(c.key_type, c.encrypted_value)

    # 4. Other project members
    if not credentials.get("openai") and prj:
        member_rows = await db.execute(
            select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
        )
        seen = {created_by_user_id, prj.owner_id}
        for (uid,) in member_rows.all():
            if uid not in seen:
                seen.add(uid)
                m_rows = await db.execute(
                    select(UserCredential).where(UserCredential.user_id == uid)
                )
                for c in m_rows.scalars().all():
                    _add_cred(c.key_type, c.encrypted_value)

    return credentials
