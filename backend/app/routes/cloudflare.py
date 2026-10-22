"""Retired endpoints: image generation was replaced with local source-image edits."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from ..db_models import User
from ..dependencies import get_current_user
from ..services.source_image import require_source_image_user

router = APIRouter(prefix="/api/cloudflare", tags=["cloudflare"])


@router.get("/config")
@router.put("/config")
@router.post("/test")
async def retired_cloudflare(user: Annotated[User, Depends(get_current_user)]):
    require_source_image_user(user)
    raise HTTPException(410, "Cloudflare generation has been replaced. Use Source Image Articles; no image API credentials are required.")
