from __future__ import annotations
import secrets
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from ..database import get_db
from ..db_models import ProjectCredential
from ..config import settings
from ..dependencies import get_current_user
from ..crypto import encrypt, decrypt
from ..services import pinterest as pinterest_service

router = APIRouter(prefix="/pinterest", tags=["pinterest"])

PINTEREST_AUTH_URL = "https://www.pinterest.com/oauth/"
PINTEREST_TOKEN_URL = "https://api.pinterest.com/v5/oauth/token"
SCOPES = "boards:read,boards:write,pins:read,pins:write,user_accounts:read"


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
    _user=Depends(get_current_user),
) -> PinterestAuthUrl:
    """Generate Pinterest OAuth authorization URL."""
    if not settings.pinterest_client_id:
        raise HTTPException(400, "Pinterest client ID not configured")
    
    state = secrets.token_urlsafe(32)
    
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
    user=Depends(get_current_user),
) -> PinterestStatus:
    """Exchange authorization code for access token and store it."""
    if not settings.pinterest_client_id or not settings.pinterest_client_secret:
        raise HTTPException(400, "Pinterest OAuth not configured")
    
    async with httpx.AsyncClient() as client:
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
        raise HTTPException(400, f"Failed to exchange code: {response.text}")
    
    token_data = response.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token", "")
    
    if not access_token:
        raise HTTPException(400, "No access token in response")
    
    token_to_store = f"{access_token}|{refresh_token}"
    encrypted = encrypt(token_to_store)
    
    stmt = select(ProjectCredential).where(
        ProjectCredential.project_id == data.project_id,
        ProjectCredential.key_type == "pinterest_token"
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()
    
    if existing:
        existing.encrypted_value = encrypted
    else:
        cred = ProjectCredential(
            project_id=data.project_id,
            key_type="pinterest_token",
            encrypted_value=encrypted,
        )
        db.add(cred)
    
    await db.commit()
    
    username = await _get_pinterest_username(access_token)
    
    return PinterestStatus(connected=True, username=username)


@router.get("/status")
async def get_status(
    project_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> PinterestStatus:
    """Check if Pinterest is connected for a project."""
    token = await _get_token(db, project_id)
    if not token:
        return PinterestStatus(connected=False)
    
    username = await _get_pinterest_username(token)
    return PinterestStatus(connected=True, username=username)


@router.delete("/disconnect")
async def disconnect(
    project_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Disconnect Pinterest from a project."""
    stmt = select(ProjectCredential).where(
        ProjectCredential.project_id == project_id,
        ProjectCredential.key_type == "pinterest_token"
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
    _user=Depends(get_current_user),
) -> list[PinterestBoard]:
    """Get user's Pinterest boards."""
    token = await _get_token(db, project_id)
    if not token:
        raise HTTPException(400, "Pinterest not connected")
    
    boards = pinterest_service.get_boards(token)
    return [PinterestBoard(id=b["id"], name=b["name"]) for b in boards]


@router.post("/create-pin")
async def create_pin(
    data: CreatePinRequest,
    db: AsyncSession = Depends(get_db),
    _user=Depends(get_current_user),
) -> CreatePinResponse:
    """Create a Pinterest pin."""
    token = await _get_token(db, data.project_id)
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


async def _get_token(db: AsyncSession, project_id: str) -> str | None:
    """Get decrypted Pinterest access token for a project."""
    stmt = select(ProjectCredential).where(
        ProjectCredential.project_id == project_id,
        ProjectCredential.key_type == "pinterest_token"
    )
    result = await db.execute(stmt)
    cred = result.scalar_one_or_none()
    
    if not cred:
        return None
    
    try:
        decrypted = decrypt(cred.encrypted_value)
        access_token = decrypted.split("|")[0]
        return access_token
    except Exception:
        return None


async def _get_pinterest_username(access_token: str) -> str | None:
    """Get Pinterest username from API."""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.pinterest.com/v5/user_account",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if response.status_code == 200:
            return response.json().get("username")
    except Exception:
        pass
    return None
