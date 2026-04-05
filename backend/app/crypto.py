from __future__ import annotations

from cryptography.fernet import Fernet

_fernet: Fernet | None = None
_dev_ephemeral_key: str | None = None


def _get_fernet() -> Fernet:
    global _fernet, _dev_ephemeral_key
    if _fernet is not None:
        return _fernet
    from app.config import settings

    key = (settings.encryption_key or "").strip()
    if settings.is_production:
        if not key:
            raise RuntimeError(
                "ENCRYPTION_KEY is required when APP_ENV=production "
                "(Fernet key from: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\")"
            )
    else:
        if not key:
            _dev_ephemeral_key = Fernet.generate_key().decode()
            key = _dev_ephemeral_key
    _fernet = Fernet(key.encode())
    return _fernet


def encrypt(plaintext: str) -> str:
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _get_fernet().decrypt(ciphertext.encode()).decode()


def get_encryption_key() -> str:
    from app.config import settings

    k = (settings.encryption_key or "").strip()
    if k:
        return k
    _get_fernet()
    if _dev_ephemeral_key is None:
        raise RuntimeError("No ENCRYPTION_KEY and not in dev ephemeral mode")
    return _dev_ephemeral_key
