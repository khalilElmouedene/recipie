"""Startup checks for production deployments."""
from __future__ import annotations

from app.config import settings

_DEFAULT_JWT = "change-me-to-a-random-secret"
_MIN_JWT_LEN = 32


def validate_production_security() -> None:
    """Raise RuntimeError if APP_ENV=production with weak or missing secrets."""
    if not settings.is_production:
        return
    if not (settings.encryption_key or "").strip():
        raise RuntimeError(
            "ENCRYPTION_KEY must be set to a Fernet key when APP_ENV=production "
            "(generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\")"
        )
    if settings.jwt_secret_key == _DEFAULT_JWT or len(settings.jwt_secret_key) < _MIN_JWT_LEN:
        raise RuntimeError(
            f"JWT_SECRET_KEY must be set to a strong secret (min {_MIN_JWT_LEN} chars), "
            "not the default placeholder, when APP_ENV=production"
        )
