"""add site_publish_schedules table for per-site auto-spy scheduling

Revision ID: add_site_publish_schedules
Revises: merge_pw_reset_site_pin_tmpl
Create Date: 2026-04-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "add_site_publish_schedules"
down_revision = "merge_pw_reset_site_pin_tmpl"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "site_publish_schedules",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("interval_minutes", sa.Integer(), nullable=False, server_default="240"),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", name="uq_site_publish_schedule"),
    )
    op.create_index("ix_site_publish_schedules_site_id", "site_publish_schedules", ["site_id"])


def downgrade():
    op.drop_index("ix_site_publish_schedules_site_id", table_name="site_publish_schedules")
    op.drop_table("site_publish_schedules")
