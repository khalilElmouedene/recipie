"""add custom_fonts column to users table

Revision ID: add_user_custom_fonts
Revises: user_owner_isolation
Create Date: 2026-03-14

"""
from alembic import op
import sqlalchemy as sa

revision = "add_user_custom_fonts"
down_revision = "user_owner_isolation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("users")]
    if "custom_fonts" not in cols:
        op.add_column("users", sa.Column("custom_fonts", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "custom_fonts")
