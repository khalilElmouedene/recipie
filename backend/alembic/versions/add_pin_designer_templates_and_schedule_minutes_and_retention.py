"""add Pin Designer templates, minutes-based scheduling, and image retention

Revision ID: add_pin_templates_min_ret
Revises: add_publish_sched_job_link
Create Date: 2026-03-18
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "add_pin_templates_min_ret"
down_revision = "add_publish_sched_job_link"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # ── Recipe -> Pin Designer template link ──────────────────────────────
    recipe_cols = [c["name"] for c in sa.inspect(bind).get_columns("recipes")]
    if "pin_template_id" not in recipe_cols:
        op.add_column("recipes", sa.Column("pin_template_id", sa.String(length=200), nullable=True))

    # ── Scheduler minutes + image retention ───────────────────────────────
    if sa.inspect(bind).has_table("project_publish_schedules"):
        sched_cols = [c["name"] for c in sa.inspect(bind).get_columns("project_publish_schedules")]

        if "interval_minutes" not in sched_cols:
            op.add_column(
                "project_publish_schedules",
                sa.Column("interval_minutes", sa.Integer(), nullable=False, server_default="240"),
            )

        # Convert existing interval_hours -> interval_minutes where possible.
        # (If interval_hours doesn't exist, the server default will apply.)
        if "interval_hours" in sched_cols and "interval_minutes" in sched_cols:
            op.execute("UPDATE project_publish_schedules SET interval_minutes = interval_hours * 60")

        if "image_retention_days" not in sched_cols:
            op.add_column(
                "project_publish_schedules",
                sa.Column("image_retention_days", sa.Integer(), nullable=False, server_default="4"),
            )

    # ── Pin Designer Templates table ──────────────────────────────────────
    if not sa.inspect(bind).has_table("pin_designer_templates"):
        op.create_table(
            "pin_designer_templates",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column(
                "owner_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("bg_color", sa.String(length=50), nullable=False, server_default="#ffffff"),
            sa.Column("elements_json", sa.Text(), nullable=False),
            sa.Column("example_image", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_pin_designer_templates_owner_id", "pin_designer_templates", ["owner_id"])


def downgrade() -> None:
    bind = op.get_bind()

    if sa.inspect(bind).has_table("pin_designer_templates"):
        op.drop_table("pin_designer_templates")

    if sa.inspect(bind).has_table("project_publish_schedules"):
        sched_cols = [c["name"] for c in sa.inspect(bind).get_columns("project_publish_schedules")]
        if "interval_minutes" in sched_cols:
            op.drop_column("project_publish_schedules", "interval_minutes")
        if "image_retention_days" in sched_cols:
            op.drop_column("project_publish_schedules", "image_retention_days")

    recipe_cols = [c["name"] for c in sa.inspect(bind).get_columns("recipes")]
    if "pin_template_id" in recipe_cols:
        op.drop_column("recipes", "pin_template_id")

