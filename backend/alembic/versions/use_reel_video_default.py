"""use the native Facebook Reel aspect ratio by default

Revision ID: use_reel_video_default
Revises: add_fb_video_settings
Create Date: 2026-08-02
"""

from alembic import op
import sqlalchemy as sa


revision = "use_reel_video_default"
down_revision = "add_fb_video_settings"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column(
        "facebook_projects",
        "video_format",
        existing_type=sa.String(length=16),
        existing_nullable=False,
        server_default=sa.text("'9:16'"),
    )


def downgrade():
    op.alter_column(
        "facebook_projects",
        "video_format",
        existing_type=sa.String(length=16),
        existing_nullable=False,
        server_default=sa.text("'2:3'"),
    )
