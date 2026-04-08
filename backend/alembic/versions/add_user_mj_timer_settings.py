"""add mj_timer_settings column to users (Midjourney sleep timers)

Revision ID: add_user_mj_timer_settings
Revises: add_template_project_ids
Create Date: 2026-04-07

"""
from alembic import op
import sqlalchemy as sa

revision = "add_user_mj_timer_settings"
down_revision = "add_template_project_ids"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("users")]
    if "mj_timer_settings" not in cols:
        op.add_column("users", sa.Column("mj_timer_settings", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "mj_timer_settings")
