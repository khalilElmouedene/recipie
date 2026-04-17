"""add image_mode to sites

Revision ID: add_site_image_mode
Revises: add_template_project_ids
Branch_labels: None
depends_on: None
"""

from alembic import op
import sqlalchemy as sa

revision = "add_site_image_mode"
down_revision = "add_template_project_ids"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "sites",
        sa.Column("image_mode", sa.String(20), nullable=False, server_default="featured_and_top"),
    )


def downgrade():
    op.drop_column("sites", "image_mode")
