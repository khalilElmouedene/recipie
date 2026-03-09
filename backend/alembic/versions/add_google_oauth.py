"""add google oauth support

Revision ID: add_google_oauth
Revises: add_site_wp_users
Create Date: 2026-03-09
"""
from alembic import op
import sqlalchemy as sa

revision: str = "add_google_oauth"
down_revision = "add_site_wp_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("google_id", sa.String(100), nullable=True))
    op.create_unique_constraint("uq_users_google_id", "users", ["google_id"])
    op.create_index("ix_users_google_id", "users", ["google_id"])
    op.alter_column("users", "password_hash", nullable=True)


def downgrade() -> None:
    op.alter_column("users", "password_hash", nullable=False)
    op.drop_index("ix_users_google_id", table_name="users")
    op.drop_constraint("uq_users_google_id", "users", type_="unique")
    op.drop_column("users", "google_id")
