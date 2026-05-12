"""add spy sheet sources

Revision ID: add_spy_sheet_sources
Revises: add_job_email_notifications
Create Date: 2026-05-12
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "add_spy_sheet_sources"
down_revision = "add_job_email_notifications"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    if not conn.dialect.has_table(conn, "spy_sheet_sources"):
        op.create_table(
            "spy_sheet_sources",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "project_id",
                UUID(as_uuid=True),
                sa.ForeignKey("projects.id", ondelete="CASCADE"),
                nullable=False,
                index=True,
            ),
            sa.Column(
                "created_by_user_id",
                UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("url", sa.String(500), nullable=False),
            sa.Column("site_name", sa.String(200), nullable=False),
            sa.Column("sheet_tab_id", sa.String(36), nullable=False),
            sa.Column("last_scanned_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade():
    op.drop_table("spy_sheet_sources")
