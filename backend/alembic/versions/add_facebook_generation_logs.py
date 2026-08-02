"""add persistent Facebook generation logs

Revision ID: add_fb_generation_logs
Revises: add_facebook_module
Create Date: 2026-08-02
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "add_fb_generation_logs"
down_revision = "add_facebook_module"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if bind.dialect.has_table(bind, "facebook_generation_logs"):
        return

    op.create_table(
        "facebook_generation_logs",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("facebook_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "content_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("facebook_contents.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("level", sa.String(16), nullable=False, server_default="info"),
        sa.Column("stage", sa.String(64), nullable=False, server_default="generation"),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_facebook_generation_logs_project_id",
        "facebook_generation_logs",
        ["project_id"],
    )
    op.create_index(
        "ix_facebook_generation_logs_content_id",
        "facebook_generation_logs",
        ["content_id"],
    )
    op.create_index(
        "ix_facebook_generation_logs_created_at",
        "facebook_generation_logs",
        ["created_at"],
    )


def downgrade():
    op.drop_table("facebook_generation_logs")
