"""add publish schedule table and recipe->job link

Revision ID: add_publish_schedule_and_job_recipe_link
Revises: add_articles_all_sites_job_type
Create Date: 2026-03-17

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "add_publish_schedule_and_job_recipe_link"
down_revision = "add_articles_all_sites_job_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    recipe_cols = [c["name"] for c in sa.inspect(bind).get_columns("recipes")]
    if "created_by_job_id" not in recipe_cols:
        op.add_column("recipes", sa.Column("created_by_job_id", postgresql.UUID(as_uuid=True), nullable=True))
        op.create_foreign_key(
            "fk_recipes_created_by_job_id_jobs",
            "recipes",
            "jobs",
            ["created_by_job_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index("ix_recipes_created_by_job_id", "recipes", ["created_by_job_id"], unique=False)

    if not sa.inspect(bind).has_table("project_publish_schedules"):
        op.create_table(
            "project_publish_schedules",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("interval_hours", sa.Integer(), nullable=False, server_default="4"),
            sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("project_id", name="uq_project_publish_schedule"),
        )


def downgrade() -> None:
    op.drop_table("project_publish_schedules")
    op.drop_index("ix_recipes_created_by_job_id", table_name="recipes")
    op.drop_constraint("fk_recipes_created_by_job_id_jobs", "recipes", type_="foreignkey")
    op.drop_column("recipes", "created_by_job_id")
