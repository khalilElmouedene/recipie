"""Shared credential loading for jobs - same logic as Paramètres/Settings."""
from __future__ import annotations
import json
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..crypto import decrypt
from ..db_models import Project, ProjectCredential, ProjectMember, User, UserCredential
from ..midjourney_settings import DEFAULT_GRID_WAIT_SECONDS, clamp_grid_wait

logger = logging.getLogger(__name__)

# Keys that are safe to inherit from arbitrary project members as a last resort.
# Discord/Midjourney credentials are intentionally excluded — using a random
# member's Discord account would create unexpected traffic on that account.
_MEMBER_FALLBACK_KEYS = {"openai"}


def _merge_mj_grid_wait(credentials: dict[str, str], owner: User | None) -> None:
    g = DEFAULT_GRID_WAIT_SECONDS
    if owner and owner.mj_timer_settings:
        try:
            j = json.loads(owner.mj_timer_settings)
            g = int(j.get("grid_wait_seconds", g))
        except (ValueError, TypeError, json.JSONDecodeError):
            pass
    g = clamp_grid_wait(g)
    credentials["mj_grid_wait_seconds"] = str(g)


async def load_credentials_for_job(
    db: AsyncSession,
    project_id: uuid.UUID,
    created_by_user_id: uuid.UUID,
) -> dict[str, str]:
    """Load credentials for a job. Uses same decrypt as Settings/Paramètres.
    Priority: Project creds, then job creator, then owner, then members.
    """
    credentials: dict[str, str] = {}
    sources: dict[str, str] = {}  # key_type → human-readable source (for audit logging only)

    def _add_cred(key_type: str, encrypted_value: str, source: str) -> None:
        if key_type not in credentials:
            try:
                credentials[key_type] = decrypt(encrypted_value)
                sources[key_type] = source
            except Exception as e:
                logger.warning(
                    "Failed to decrypt credential '%s' from %s for project %s: %s",
                    key_type, source, project_id, e,
                )

    # 1. Project credentials
    proj_rows = await db.execute(
        select(ProjectCredential).where(ProjectCredential.project_id == project_id)
    )
    for c in proj_rows.scalars().all():
        _add_cred(c.key_type, c.encrypted_value, "project")

    # 2. Job creator's user credentials (Paramètres)
    user_rows = await db.execute(
        select(UserCredential).where(UserCredential.user_id == created_by_user_id)
    )
    for c in user_rows.scalars().all():
        _add_cred(c.key_type, c.encrypted_value, "job_creator")

    # 3. Project owner fallback
    prj = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if prj and prj.owner_id != created_by_user_id:
        owner_rows = await db.execute(
            select(UserCredential).where(UserCredential.user_id == prj.owner_id)
        )
        for c in owner_rows.scalars().all():
            _add_cred(c.key_type, c.encrypted_value, "project_owner")

    # 4. Other project members — ONLY for keys in _MEMBER_FALLBACK_KEYS (e.g. openai).
    # Discord/Midjourney credentials are never pulled from arbitrary members to prevent
    # using the wrong Discord account and causing unexpected bans on that member's account.
    missing_fallback = _MEMBER_FALLBACK_KEYS - credentials.keys()
    if missing_fallback and prj:
        member_rows = await db.execute(
            select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)
        )
        seen = {created_by_user_id, prj.owner_id}
        for (uid,) in member_rows.all():
            if not missing_fallback:
                break
            if uid not in seen:
                seen.add(uid)
                m_rows = await db.execute(
                    select(UserCredential).where(
                        UserCredential.user_id == uid,
                        UserCredential.key_type.in_(list(missing_fallback)),
                    )
                )
                for c in m_rows.scalars().all():
                    _add_cred(c.key_type, c.encrypted_value, f"member:{uid}")
                    missing_fallback = _MEMBER_FALLBACK_KEYS - credentials.keys()

    owner_user: User | None = None
    if prj:
        owner_user = (await db.execute(select(User).where(User.id == prj.owner_id))).scalar_one_or_none()
    _merge_mj_grid_wait(credentials, owner_user)

    logger.info(
        "Credentials loaded for project %s — sources: %s",
        project_id,
        {k: sources.get(k, "not_found") for k in ["openai", "discord_auth", "discord_channel", "discord_app_id"]},
    )

    return credentials
