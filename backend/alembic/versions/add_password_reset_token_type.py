"""add token_type to password_setup_tokens

Revision ID: add_pw_reset_token_type
Revises: merge_mj_pin_elems
Create Date: 2026-04-22
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "add_pw_reset_token_type"
down_revision = "merge_mj_pin_elems"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "password_setup_tokens",
        sa.Column("token_type", sa.String(16), nullable=False, server_default="invite"),
    )


def downgrade() -> None:
    op.drop_column("password_setup_tokens", "token_type")
