"""add embed_pin_in_article to sites

Revision ID: add_site_embed_pin_in_article
Revises: add_site_image_mode
Branch_labels: None
depends_on: None
"""

from alembic import op
import sqlalchemy as sa

revision = "add_site_embed_pin_in_article"
down_revision = "add_site_image_mode"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "sites",
        sa.Column("embed_pin_in_article", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade():
    op.drop_column("sites", "embed_pin_in_article")
