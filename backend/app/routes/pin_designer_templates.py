from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import PinDesignerTemplate, User
from ..dependencies import get_current_user
from ..models import (
    PinDesignerTemplateCreate,
    PinDesignerTemplateOut,
)

router = APIRouter(tags=["pin-designer-templates"])


def _parse_elements(elements_json: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(elements_json) if elements_json else []
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


@router.get("/api/pin-designer-templates", response_model=list[PinDesignerTemplateOut])
async def list_pin_designer_templates(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        select(PinDesignerTemplate)
        .where(PinDesignerTemplate.owner_id == user.id)
        .order_by(PinDesignerTemplate.created_at.desc())
    )
    templates = rows.scalars().all()
    out: list[PinDesignerTemplateOut] = []
    for t in templates:
        out.append(
            PinDesignerTemplateOut(
                id=t.id,
                owner_id=t.owner_id,
                name=t.name,
                description=t.description,
                bgColor=t.bg_color,
                previewLayout="simple",
                elements=_parse_elements(t.elements_json),
            )
        )
    return out


@router.post(
    "/api/pin-designer-templates",
    response_model=PinDesignerTemplateOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_pin_designer_template(
    body: PinDesignerTemplateCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tmpl = PinDesignerTemplate(
        owner_id=user.id,
        name=body.name,
        description=body.description,
        bg_color=body.bgColor,
        elements_json=json.dumps([e.model_dump() for e in body.elements]),
    )
    db.add(tmpl)
    await db.commit()
    await db.refresh(tmpl)
    return PinDesignerTemplateOut(
        id=tmpl.id,
        owner_id=tmpl.owner_id,
        name=tmpl.name,
        description=tmpl.description,
        bgColor=tmpl.bg_color,
        previewLayout="simple",
        elements=_parse_elements(tmpl.elements_json),
    )


@router.delete("/api/pin-designer-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pin_designer_template(
    template_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        import uuid as _uuid

        tid = _uuid.UUID(template_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid template id")

    row = await db.execute(select(PinDesignerTemplate).where(PinDesignerTemplate.id == tid, PinDesignerTemplate.owner_id == user.id))
    tmpl = row.scalar_one_or_none()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
    await db.delete(tmpl)
    await db.commit()
    return None

