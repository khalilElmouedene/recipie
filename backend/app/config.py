from __future__ import annotations
from pathlib import Path

import os

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(BASE_DIR / ".env"), env_file_encoding="utf-8")

    # Set APP_ENV=production in real deployments to enforce secrets and stricter defaults.
    app_env: str = "development"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/recipebot"
    jwt_secret_key: str = "change-me-to-a-random-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440
    encryption_key: str = ""
    cors_origins: str = "http://localhost:3000"
    # When false, POST /api/auth/register and new Google sign-ups are rejected (existing users still work).
    registration_enabled: bool = True
    
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

    @field_validator("registration_enabled", mode="before")
    @classmethod
    def _parse_registration_flag(cls, v):
        if isinstance(v, str):
            s = v.strip().lower()
            if s in ("1", "true", "yes", "on"):
                return True
            if s in ("0", "false", "no", "off", ""):
                return False
        return bool(v)

    @property
    def is_production(self) -> bool:
        return self.app_env.strip().lower() == "production"

    @model_validator(mode="after")
    def _registration_default_in_production(self):
        if self.is_production and "REGISTRATION_ENABLED" not in os.environ:
            return self.model_copy(update={"registration_enabled": False})
        return self


settings = Settings()
