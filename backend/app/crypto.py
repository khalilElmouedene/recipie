from __future__ import annotations
import os
from cryptography.fernet import Fernet

_key = os.getenv("ENCRYPTION_KEY", "")
if not _key:
    _key = Fernet.generate_key().decode()

_fernet = Fernet(_key.encode() if isinstance(_key, str) else _key)


def encrypt(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _fernet.decrypt(ciphertext.encode()).decode()


def get_encryption_key() -> str:
    return _key
