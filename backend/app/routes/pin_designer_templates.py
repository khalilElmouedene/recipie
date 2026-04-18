from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..db_models import PinDesignerTemplate, Project, ProjectMember, User
from ..dependencies import get_current_user
from ..models import (
    PinDesignerTemplateCreate,
    PinDesignerTemplateOut,
    PinDesignerTemplateUpdate,
)

router = APIRouter(tags=["pin-designer-templates"])


def _parse_elements(elements_json: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(elements_json) if elements_json else []
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _parse_project_ids(raw: str | None) -> list[str] | None:
    if raw is None:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else None
    except Exception:
        return None


def _template_out(t: PinDesignerTemplate) -> PinDesignerTemplateOut:
    return PinDesignerTemplateOut(
        id=t.id,
        owner_id=t.owner_id,
        name=t.name,
        description=t.description,
        bgColor=t.bg_color,
        canvasWidth=t.canvas_width,
        canvasHeight=t.canvas_height,
        previewLayout="simple",
        project_ids=_parse_project_ids(t.project_ids),
        elements=_parse_elements(t.elements_json),
    )


@router.get("/api/pin-designer-templates", response_model=list[PinDesignerTemplateOut])
async def list_pin_designer_templates(
    project_id: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Templates are private by default — only visible to their creator.
    # When project_id is supplied, also include templates from other project
    # members/owners that have been explicitly assigned to that project.

    if project_id:
        try:
            proj_uuid = uuid.UUID(project_id)
        except Exception:
            return []

        # Verify caller is a member or owner of the project
        proj_row = await db.execute(select(Project).where(Project.id == proj_uuid))
        proj = proj_row.scalar_one_or_none()
        if not proj:
            return []

        if proj.owner_id != user.id:
            member_row = await db.execute(
                select(ProjectMember).where(
                    ProjectMember.project_id == proj_uuid,
                    ProjectMember.user_id == user.id,
                )
            )
            if not member_row.scalar_one_or_none():
                return []

        # Caller's own templates (always visible regardless of assignment)
        own_q = await db.execute(
            select(PinDesignerTemplate)
            .where(PinDesignerTemplate.owner_id == user.id)
            .order_by(PinDesignerTemplate.created_at.desc())
        )
        own_templates = own_q.scalars().all()

        # Other users' templates assigned to this project (JSON contains project_id)
        shared_q = await db.execute(
            select(PinDesignerTemplate)
            .where(
                PinDesignerTemplate.owner_id != user.id,
                PinDesignerTemplate.project_ids.contains(project_id),
            )
            .order_by(PinDesignerTemplate.created_at.desc())
        )
        shared_candidates = shared_q.scalars().all()

        out: list[PinDesignerTemplateOut] = [_template_out(t) for t in own_templates]
        for t in shared_candidates:
            pids = _parse_project_ids(t.project_ids)
            if pids and project_id in pids:
                out.append(_template_out(t))
        return out

    # No project_id: return only the caller's own templates
    rows = await db.execute(
        select(PinDesignerTemplate)
        .where(PinDesignerTemplate.owner_id == user.id)
        .order_by(PinDesignerTemplate.created_at.desc())
    )
    return [_template_out(t) for t in rows.scalars().all()]


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
    normalized_name = body.name.strip()
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Template name is required")

    existing_row = await db.execute(
        select(PinDesignerTemplate.id).where(
            PinDesignerTemplate.owner_id == user.id,
            func.lower(PinDesignerTemplate.name) == normalized_name.lower(),
        )
    )
    if existing_row.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f'Template name "{normalized_name}" already exists. Choose a different name.',
        )

    tmpl = PinDesignerTemplate(
        owner_id=user.id,
        name=normalized_name,
        description=body.description,
        bg_color=body.bgColor,
        canvas_width=body.canvasWidth,
        canvas_height=body.canvasHeight,
        elements_json=json.dumps([e.model_dump() for e in body.elements]),
        project_ids=json.dumps(body.project_ids) if body.project_ids is not None else None,
    )
    db.add(tmpl)
    await db.commit()
    await db.refresh(tmpl)
    return _template_out(tmpl)


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


@router.put("/api/pin-designer-templates/{template_id}", response_model=PinDesignerTemplateOut)
async def update_pin_designer_template(
    template_id: str,
    body: PinDesignerTemplateUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        import uuid as _uuid

        tid = _uuid.UUID(template_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid template id")

    row = await db.execute(
        select(PinDesignerTemplate).where(
            PinDesignerTemplate.id == tid,
            PinDesignerTemplate.owner_id == user.id,
        )
    )
    tmpl = row.scalar_one_or_none()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")

    if body.name is not None:
        normalized_name = body.name.strip()
        if not normalized_name:
            raise HTTPException(status_code=400, detail="Template name is required")
        existing_row = await db.execute(
            select(PinDesignerTemplate.id).where(
                PinDesignerTemplate.owner_id == user.id,
                PinDesignerTemplate.id != tid,
                func.lower(PinDesignerTemplate.name) == normalized_name.lower(),
            )
        )
        if existing_row.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=f'Template name "{normalized_name}" already exists. Choose a different name.',
            )
        tmpl.name = normalized_name

    if body.description is not None:
        tmpl.description = body.description
    if body.bgColor is not None:
        tmpl.bg_color = body.bgColor
    if body.canvasWidth is not None:
        tmpl.canvas_width = body.canvasWidth
    if body.canvasHeight is not None:
        tmpl.canvas_height = body.canvasHeight
    if body.elements is not None:
        tmpl.elements_json = json.dumps([e.model_dump() for e in body.elements])
    if "project_ids" in body.model_fields_set:
        tmpl.project_ids = json.dumps(body.project_ids) if body.project_ids is not None else None

    await db.commit()
    await db.refresh(tmpl)
    return _template_out(tmpl)

