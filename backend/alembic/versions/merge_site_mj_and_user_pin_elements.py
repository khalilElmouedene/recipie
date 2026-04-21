"""merge site mj upscale + user pin elements heads

Revision ID: merge_site_mj_and_user_pin_elements
Revises: add_site_mj_upscale_count, add_user_custom_pin_elements
Create Date: 2026-04-21
"""

from __future__ import annotations

revision = "merge_site_mj_and_user_pin_elements"
down_revision = ("add_site_mj_upscale_count", "add_user_custom_pin_elements")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Merge-only revision: schema changes are handled by parent heads.
    pass


def downgrade() -> None:
    # Merge-only revision: no schema operation.
    pass

