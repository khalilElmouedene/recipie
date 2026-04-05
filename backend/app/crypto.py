from __future__ import annotations
import os
from cryptography.fernet import Fernet

_key = os.getenv("ENCRYPTION_KEY", "")
if not _key:
    raise RuntimeError(
        "ENCRYPTION_KEY environment variable is not set. "
        "Generate a key with: "
        "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" "
        "then add it to your .env file."
    )

_fernet = Fernet(_key.encode() if isinstance(_key, str) else _key)


def encrypt(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _fernet.decrypt(ciphertext.encode()).decode()


def get_encryption_key() -> str:
    return _key
