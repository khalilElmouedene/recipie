"""Helpers to get WordPress credentials from a Site, with random user selection."""
from __future__ import annotations
import json
import random

from .crypto import decrypt


def get_random_wp_credentials(site) -> tuple[str, str]:
    """Returns (username, password) for a random WP user.
    Supports wp_users_enc (array) and legacy wp_username/wp_password_enc.
    """
    if site.wp_users_enc:
        try:
            users = json.loads(site.wp_users_enc)
            if users:
                u = random.choice(users)
                return u["username"], decrypt(u["password_enc"])
        except (json.JSONDecodeError, KeyError, TypeError):
            pass
    if site.wp_username and site.wp_password_enc:
        return site.wp_username, decrypt(site.wp_password_enc)
    raise ValueError("No WP credentials configured for this site")
