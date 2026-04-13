"""add spy_sheets table

Revision ID: add_spy_sheets
Revises: add_template_project_ids
Create Date: 2026-04-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "add_spy_sheets"
down_revision = "add_user_mj_grid_wait_settings"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "spy_sheets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True, index=True),
        sa.Column("data", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_table("spy_sheets")
