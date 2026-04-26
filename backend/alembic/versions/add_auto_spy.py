"""add auto_spy tables

Revision ID: add_auto_spy
Revises: add_spy_sheets
Create Date: 2026-04-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "add_auto_spy"
down_revision = "add_audit_logs"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    if not conn.dialect.has_table(conn, "auto_spy_sheets"):
        op.create_table(
            "auto_spy_sheets",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "project_id",
                UUID(as_uuid=True),
                sa.ForeignKey("projects.id", ondelete="CASCADE"),
                nullable=False,
                unique=True,
                index=True,
            ),
            sa.Column("data", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )

    if not conn.dialect.has_table(conn, "auto_spy_sources"):
        op.create_table(
            "auto_spy_sources",
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
            sa.Column("next_scan_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade():
    op.drop_table("auto_spy_sources")
    op.drop_table("auto_spy_sheets")
