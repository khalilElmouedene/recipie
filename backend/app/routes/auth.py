from __future__ import annotations
import secrets
import time
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import hash_password, verify_password, create_access_token
from ..config import settings
from ..database import get_db
from ..db_models import User, UserRole
from ..dependencies import get_current_user
from ..models import RegisterRequest, LoginRequest, TokenResponse, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ── Google OAuth state store ─────────────────────────────────────────────────
_GOOGLE_STATES: dict[str, float] = {}
_STATE_TTL = 600  # 10 minutes


def _issue_state() -> str:
    now = time.monotonic()
    expired = [k for k, exp in _GOOGLE_STATES.items() if now > exp]
    for k in expired:
        del _GOOGLE_STATES[k]
    state = secrets.token_urlsafe(32)
    _GOOGLE_STATES[state] = now + _STATE_TTL
    return state


def _consume_state(state: str) -> bool:
    now = time.monotonic()
    exp = _GOOGLE_STATES.pop(state, None)
    return exp is not None and now <= exp


# ── Pydantic models ──────────────────────────────────────────────────────────
class GoogleAuthUrl(BaseModel):
    url: str
    state: str


class GoogleCallbackRequest(BaseModel):
    code: str
    state: str


# ── Standard auth ────────────────────────────────────────────────────────────
@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    user_count = await db.scalar(select(func.count()).select_from(User))
    role = UserRole.owner if user_count == 0 else UserRole.member

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        full_name=body.full_name,
        role=role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(str(user.id), user.role.value)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(str(user.id), user.role.value)
    return TokenResponse(access_token=token)


@router.get("/me", response_model=UserOut)
async def me(current_user: Annotated[User, Depends(get_current_user)]):
    return current_user


# ── Google OAuth ─────────────────────────────────────────────────────────────
_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


@router.get("/google/url", response_model=GoogleAuthUrl)
async def google_auth_url():
    """Return the Google OAuth authorization URL."""
    if not settings.google_client_id:
        raise HTTPException(400, "Google OAuth not configured")

    state = _issue_state()
    params = (
        f"client_id={settings.google_client_id}"
        f"&redirect_uri={settings.google_redirect_uri}"
        f"&response_type=code"
        f"&scope=openid+email+profile"
        f"&state={state}"
        f"&access_type=offline"
    )
    return GoogleAuthUrl(url=f"{_GOOGLE_AUTH_URL}?{params}", state=state)


@router.post("/google/callback", response_model=TokenResponse)
async def google_callback(
    body: GoogleCallbackRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Exchange Google auth code for a JWT token."""
    if not _consume_state(body.state):
        raise HTTPException(400, "Invalid or expired state — please try again")

    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(400, "Google OAuth not configured")

    # Exchange code for access token
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(_GOOGLE_TOKEN_URL, data={
            "code": body.code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.google_redirect_uri,
            "grant_type": "authorization_code",
        })

    if token_resp.status_code != 200:
        raise HTTPException(400, "Failed to exchange Google authorization code")

    access_token = token_resp.json().get("access_token")
    if not access_token:
        raise HTTPException(400, "No access token returned by Google")

    # Get user info from Google
    async with httpx.AsyncClient() as client:
        info_resp = await client.get(
            _GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )

    if info_resp.status_code != 200:
        raise HTTPException(400, "Failed to retrieve Google user info")

    google_data = info_resp.json()
    google_id = google_data.get("sub")
    email = google_data.get("email")
    full_name = google_data.get("name") or email

    if not google_id or not email:
        raise HTTPException(400, "Google account is missing required information")

    # Find existing user by google_id first, then by email (link accounts)
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()

    if not user:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            # Link Google to existing email account
            user.google_id = google_id
        else:
            # Brand new user — first user becomes owner
            user_count = await db.scalar(select(func.count()).select_from(User))
            role = UserRole.owner if user_count == 0 else UserRole.member
            user = User(
                email=email,
                password_hash=None,
                full_name=full_name,
                role=role,
                google_id=google_id,
            )
            db.add(user)

    await db.commit()
    await db.refresh(user)

    token = create_access_token(str(user.id), user.role.value)
    return TokenResponse(access_token=token)
