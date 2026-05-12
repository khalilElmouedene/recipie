"""add job email notification sent marker

Revision ID: add_job_email_notifications
Revises: add_site_generate_recipe_json
Create Date: 2026-05-11

"""
from alembic import op
import sqlalchemy as sa

revision = "add_job_email_notifications"
down_revision = "add_site_generate_recipe_json"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("jobs")]
    if "email_notification_sent_at" not in cols:
        op.add_column(
            "jobs",
            sa.Column("email_notification_sent_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.execute(
            "UPDATE jobs SET email_notification_sent_at = NOW() "
            "WHERE status IN ('completed', 'failed', 'stopped')"
        )


def downgrade():
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("jobs")]
    if "email_notification_sent_at" in cols:
        op.drop_column("jobs", "email_notification_sent_at")
