from __future__ import annotations

import logging
import uuid

from app.database import SessionLocal
from app.db_models import FacebookGenerationLog


logger = logging.getLogger(__name__)
VALID_LEVELS = {"info", "success", "warning", "error"}


async def write_facebook_log(
    project_id: uuid.UUID,
    message: str,
    *,
    content_id: uuid.UUID | None = None,
    level: str = "info",
    stage: str = "generation",
) -> None:
    """Persist a progress message without allowing logging failure to stop work."""
    safe_level = level if level in VALID_LEVELS else "info"
    safe_stage = (stage or "generation").strip()[:64]
    safe_message = str(message).strip()[:4000]
    if not safe_message:
        return
    try:
        async with SessionLocal() as db:
            db.add(
                FacebookGenerationLog(
                    project_id=project_id,
                    content_id=content_id,
                    level=safe_level,
                    stage=safe_stage,
                    message=safe_message,
                )
            )
            await db.commit()
    except Exception:
        logger.exception("Could not persist Facebook generation log")
