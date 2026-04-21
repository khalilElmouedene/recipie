"""add mj_upscale_count to sites

Revision ID: add_site_mj_upscale_count
Revises: add_site_embed_pin_in_article
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa

revision = "add_site_mj_upscale_count"
down_revision = "add_site_embed_pin_in_article"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "sites",
        sa.Column("mj_upscale_count", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade():
    op.drop_column("sites", "mj_upscale_count")
