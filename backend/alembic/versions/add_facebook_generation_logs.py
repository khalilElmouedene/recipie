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
    inspector = sa.inspect(bind)

    project_columns = {
        column["name"] for column in inspector.get_columns("facebook_projects")
    }
    if "generation_paused" not in project_columns:
        op.add_column(
            "facebook_projects",
            sa.Column(
                "generation_paused",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )

    content_columns = {
        column["name"] for column in inspector.get_columns("facebook_contents")
    }
    if "generation_cancelled" not in content_columns:
        op.add_column(
            "facebook_contents",
            sa.Column(
                "generation_cancelled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )

    if not inspector.has_table("facebook_generation_logs"):
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
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("facebook_generation_logs"):
        op.drop_table("facebook_generation_logs")
    content_columns = {
        column["name"] for column in inspector.get_columns("facebook_contents")
    }
    if "generation_cancelled" in content_columns:
        op.drop_column("facebook_contents", "generation_cancelled")
    project_columns = {
        column["name"] for column in inspector.get_columns("facebook_projects")
    }
    if "generation_paused" in project_columns:
        op.drop_column("facebook_projects", "generation_paused")
