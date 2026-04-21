from __future__ import annotations
import logging
import os
from pathlib import Path
from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent

_INSECURE_JWT_DEFAULTS = {"change-me-to-a-random-secret", "secret", ""}

_log = logging.getLogger(__name__)


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/recipebot"
    jwt_secret_key: str = "change-me-to-a-random-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440
    encryption_key: str = ""
    cors_origins: str = "http://localhost:3000"
    
    # Base URL this server is reachable at (used to build permanent image URLs)
    server_base_url: str = "http://localhost:8000"

    # Pinterest OAuth
    pinterest_client_id: str = ""
    pinterest_client_secret: str = ""
    pinterest_redirect_uri: str = "http://localhost:3000/pinterest/callback"

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:3000/auth/google/callback"

    # Threads OAuth
    threads_app_id: str = ""
    threads_app_secret: str = ""
    threads_redirect_uri: str = "http://localhost:3000/threads/callback"

    # Cloudinary
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""

    # Email / SMTP
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_name: str = "Recipe Generator"
    frontend_url: str = "http://localhost:3000"

    class Config:
        env_file = str(BASE_DIR / ".env")
        env_file_encoding = "utf-8"


settings = Settings()

_is_weak_jwt_secret = (
    settings.jwt_secret_key in _INSECURE_JWT_DEFAULTS
    or len(settings.jwt_secret_key) < 32
)

# Fail hard in production to prevent accidental insecure deployments.
if _is_weak_jwt_secret:
    msg = (
        "INSECURE JWT SECRET: jwt_secret_key is weak or still set to the default placeholder. "
        "Set JWT_SECRET_KEY to a random 64-character string in your .env file. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
    app_env = os.getenv("APP_ENV", "production").lower().strip()
    if app_env == "production":
        raise RuntimeError(msg)
    _log.warning(msg)
