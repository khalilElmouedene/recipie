"""add reusable pin elements column to users

Revision ID: add_user_custom_pin_elements
Revises: add_site_embed_pin_in_article
Create Date: 2026-04-20

"""
from alembic import op
import sqlalchemy as sa

revision = "add_user_custom_pin_elements"
down_revision = "add_site_embed_pin_in_article"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("users")]
    if "custom_pin_elements" not in cols:
        op.add_column("users", sa.Column("custom_pin_elements", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("users")]
    if "custom_pin_elements" in cols:
        op.drop_column("users", "custom_pin_elements")
