"""add standalone image generation batches

Revision ID: add_image_batches
Revises: add_fb_image_custom_settings
Create Date: 2026-08-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "add_image_batches"
down_revision = "add_fb_image_custom_settings"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()
    if "image_batches" not in tables:
        op.create_table(
            "image_batches",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("total_prompts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("completed_prompts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("total_images", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_image_batches_project_id", "image_batches", ["project_id"])
        op.create_index("ix_image_batches_status", "image_batches", ["status"])

    if "image_generations" not in tables:
        op.create_table(
            "image_generations",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("prompt", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("image_urls", sa.JSON(), nullable=True),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["batch_id"], ["image_batches.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_image_generations_batch_id", "image_generations", ["batch_id"])


def downgrade():
    op.drop_table("image_generations")
    op.drop_table("image_batches")
