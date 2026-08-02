"""add project-scoped Facebook video settings

Revision ID: add_fb_video_settings
Revises: add_fb_generation_logs
Create Date: 2026-08-02
"""

from alembic import op
import sqlalchemy as sa


revision = "add_fb_video_settings"
down_revision = "add_fb_generation_logs"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {
        column["name"] for column in inspector.get_columns("facebook_projects")
    }
    additions = (
        ("video_format", sa.String(16), "2:3"),
        ("video_intro_seconds", sa.Float(), "5.0"),
        ("video_fps", sa.Integer(), "30"),
        ("video_bitrate_kbps", sa.Integer(), "8000"),
    )
    for name, column_type, default in additions:
        if name not in columns:
            op.add_column(
                "facebook_projects",
                sa.Column(
                    name,
                    column_type,
                    nullable=False,
                    server_default=sa.text(f"'{default}'"),
                ),
            )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {
        column["name"] for column in inspector.get_columns("facebook_projects")
    }
    for name in (
        "video_bitrate_kbps",
        "video_fps",
        "video_intro_seconds",
        "video_format",
    ):
        if name in columns:
            op.drop_column("facebook_projects", name)
