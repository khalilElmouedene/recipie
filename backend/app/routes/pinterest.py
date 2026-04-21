from __future__ import annotations

import logging
import secrets
import time
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..crypto import decrypt, encrypt
from ..database import get_db
from ..db_models import ProjectCredential, ProjectMemberRole, User
from ..dependencies import check_project_access, get_current_user
from ..services import pinterest as pinterest_service

router = APIRouter(prefix="/pinterest", tags=["pinterest"])
logger = logging.getLogger(__name__)

PINTEREST_AUTH_URL = "https://www.pinterest.com/oauth/"
PINTEREST_TOKEN_URL = "https://api.pinterest.com/v5/oauth/token"
SCOPES = "boards:read,boards:write,pins:read,pins:write,user_accounts:read"

# In-memory store of valid OAuth states: {state: expiry_timestamp}
# States are valid for 10 minutes; purged on each new auth request.
_VALID_STATES: dict[str, float] = {}
_STATE_TTL = 600  # seconds


def _issue_state() -> str:
    """Generate and register a new OAuth state token."""
    now = time.monotonic()
    expired = [k for k, exp in _VALID_STATES.items() if now > exp]
    for k in expired:
        del _VALID_STATES[k]
    state = secrets.token_urlsafe(32)
    _VALID_STATES[state] = now + _STATE_TTL
    return state


def _consume_state(state: str) -> bool:
    """Return True and remove the state if it is valid; False otherwise."""
    now = time.monotonic()
    exp = _VALID_STATES.pop(state, None)
    return exp is not None and now <= exp


def _parse_project_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid project id")


class PinterestAuthUrl(BaseModel):
    url: str
    state: str


class PinterestCallback(BaseModel):
    code: str
    state: str
    project_id: str


class PinterestStatus(BaseModel):
    connected: bool
    username: str | None = None


class PinterestBoard(BaseModel):
    id: str
    name: str


class CreatePinRequest(BaseModel):
    project_id: str
    board_id: str
    image_url: str
    title: str
    description: str
    link: str = ""


class CreatePinResponse(BaseModel):
    success: bool
    pin_id: str | None = None
    pin_url: str | None = None
    error: str | None = None


@router.get("/auth-url")
async def get_auth_url(
    project_id: str = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PinterestAuthUrl:
    """Generate Pinterest OAuth authorization URL."""
    if not settings.pinterest_client_id:
        raise HTTPException(400, "Pinterest client ID not configured")

    project_uuid = _parse_project_id(project_id)
    await check_project_access(project_uuid, user, db, require_roles=[ProjectMemberRole.admin])

    state = _issue_state()
    url = (
        f"{PINTEREST_AUTH_URL}?"
        f"client_id={settings.pinterest_client_id}"
        f"&redirect_uri={settings.pinterest_redirect_uri}"
        f"&response_type=code"
        f"&scope={SCOPES}"
        f"&state={state}"
    )
    return PinterestAuthUrl(url=url, state=state)


@router.post("/callback")
async def handle_callback(
    data: PinterestCallback,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PinterestStatus:
    """Exchange authorization code for access token and store it."""
    project_uuid = _parse_project_id(data.project_id)
    await check_project_access(project_uuid, user, db, require_roles=[ProjectMemberRole.admin])

    if not _consume_state(data.state):
        raise HTTPException(400, "Invalid or expired OAuth state - please restart the authorization flow")
    if not settings.pinterest_client_id or not settings.pinterest_client_secret:
        raise HTTPException(400, "Pinterest OAuth not configured")

    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0, read=15.0)) as client:
        response = await client.post(
            PINTEREST_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": data.code,
                "redirect_uri": settings.pinterest_redirect_uri,
            },
            auth=(settings.pinterest_client_id, settings.pinterest_client_secret),
        )

    if response.status_code != 200:
        logger.warning(
            "Pinterest OAuth token exchange failed (status=%s, body=%s)",
            response.status_code,
            (response.text or "")[:300],
        )
        raise HTTPException(400, "Failed to exchange Pinterest authorization code")

    token_data = response.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token", "")
    if not access_token:
        raise HTTPException(400, "No access token in response")

    encrypted = encrypt(f"{access_token}|{refresh_token}")
    stmt = select(ProjectCredential).where(
        ProjectCredential.project_id == project_uuid,
        ProjectCredential.key_type == "pinterest_token",
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()
    if existing:
        existing.encrypted_value = encrypted
    else:
        db.add(
            ProjectCredential(
                project_id=project_uuid,
                key_type="pinterest_token",
                encrypted_value=encrypted,
            )
        )

    await db.commit()
    username = await _get_pinterest_username(access_token)
    return PinterestStatus(connected=True, username=username)


@router.get("/status")
async def get_status(
    project_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PinterestStatus:
    """Check if Pinterest is connected for a project."""
    project_uuid = _parse_project_id(project_id)
    await check_project_access(project_uuid, user, db)

    token = await _get_token(db, project_uuid)
    if not token:
        return PinterestStatus(connected=False)
    username = await _get_pinterest_username(token)
    return PinterestStatus(connected=True, username=username)


@router.delete("/disconnect")
async def disconnect(
    project_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Disconnect Pinterest from a project."""
    project_uuid = _parse_project_id(project_id)
    await check_project_access(project_uuid, user, db, require_roles=[ProjectMemberRole.admin])

    stmt = select(ProjectCredential).where(
        ProjectCredential.project_id == project_uuid,
        ProjectCredential.key_type == "pinterest_token",
    )
    result = await db.execute(stmt)
    cred = result.scalar_one_or_none()
    if cred:
        await db.delete(cred)
        await db.commit()
    return {"status": "disconnected"}


@router.get("/boards")
async def get_boards(
    project_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[PinterestBoard]:
    """Get user's Pinterest boards."""
    project_uuid = _parse_project_id(project_id)
    await check_project_access(project_uuid, user, db)

    token = await _get_token(db, project_uuid)
    if not token:
        raise HTTPException(400, "Pinterest not connected")

    boards = pinterest_service.get_boards(token)
    return [PinterestBoard(id=b["id"], name=b["name"]) for b in boards]


@router.post("/create-pin")
async def create_pin(
    data: CreatePinRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CreatePinResponse:
    """Create a Pinterest pin."""
    project_uuid = _parse_project_id(data.project_id)
    await check_project_access(project_uuid, user, db)

    token = await _get_token(db, project_uuid)
    if not token:
        raise HTTPException(400, "Pinterest not connected")

    result = pinterest_service.create_pin(
        access_token=token,
        board_id=data.board_id,
        image_url=data.image_url,
        title=data.title,
        description=data.description,
        link=data.link,
    )
    if "error" in result:
        return CreatePinResponse(success=False, error=result["error"])
    return CreatePinResponse(
        success=True,
        pin_id=result.get("pin_id"),
        pin_url=result.get("pin_url"),
    )


async def _get_token(db: AsyncSession, project_id: uuid.UUID) -> str | None:
    """Get decrypted Pinterest access token for a project."""
    stmt = select(ProjectCredential).where(
        ProjectCredential.project_id == project_id,
        ProjectCredential.key_type == "pinterest_token",
    )
    result = await db.execute(stmt)
    cred = result.scalar_one_or_none()
    if not cred:
        return None
    try:
        decrypted = decrypt(cred.encrypted_value)
        return decrypted.split("|")[0]
    except Exception:
        return None


async def _get_pinterest_username(access_token: str) -> str | None:
    """Get Pinterest username from API."""
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0, read=10.0)) as client:
            response = await client.get(
                "https://api.pinterest.com/v5/user_account",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if response.status_code == 200:
            return response.json().get("username")
    except Exception:
        pass
    return None
