"""drop mj_timer_settings column from users (timers are fixed in code)

Revision ID: drop_user_mj_timer_settings
Revises: add_user_mj_timer_settings
Create Date: 2026-04-07

"""
from alembic import op
import sqlalchemy as sa

revision = "drop_user_mj_timer_settings"
down_revision = "add_user_mj_timer_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("users")]
    if "mj_timer_settings" in cols:
        op.drop_column("users", "mj_timer_settings")


def downgrade() -> None:
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("users")]
    if "mj_timer_settings" not in cols:
        op.add_column("users", sa.Column("mj_timer_settings", sa.Text(), nullable=True))
