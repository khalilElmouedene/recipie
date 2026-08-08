"""add persistent Midjourney generation tracking

Revision ID: add_mj_generation_tracking
Revises: add_fb_page_generation
Create Date: 2026-08-07
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "add_mj_generation_tracking"
down_revision = "add_fb_page_generation"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "midjourney_generations" in inspector.get_table_names():
        return

    op.create_table(
        "midjourney_generations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recipe_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="created"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("recipe_name", sa.Text(), nullable=True),
        sa.Column("source_image_url", sa.Text(), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=True),
        sa.Column("discord_application_id", sa.String(length=64), nullable=True),
        sa.Column("discord_guild_id", sa.String(length=64), nullable=True),
        sa.Column("discord_channel_id", sa.String(length=64), nullable=True),
        sa.Column("discord_command_version", sa.String(length=64), nullable=True),
        sa.Column("discord_command_id", sa.String(length=64), nullable=True),
        sa.Column("discord_session_id", sa.String(length=64), nullable=True),
        sa.Column("interaction_nonce", sa.String(length=32), nullable=True),
        sa.Column("baseline_message_id", sa.String(length=64), nullable=True),
        sa.Column("tracked_message_id", sa.String(length=64), nullable=True),
        sa.Column("grid_message_id", sa.String(length=64), nullable=True),
        sa.Column("grid_custom_ids", sa.JSON(), nullable=True),
        sa.Column("grid_job_tokens", sa.JSON(), nullable=True),
        sa.Column("upscale_baseline_message_id", sa.String(length=64), nullable=True),
        sa.Column("requested_custom_ids", sa.JSON(), nullable=True),
        sa.Column("expected_upscale_count", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("result_message_ids", sa.JSON(), nullable=True),
        sa.Column("image_urls", sa.JSON(), nullable=True),
        sa.Column("cached_image_urls", sa.JSON(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("grid_ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delayed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_polled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["recipe_id"], ["recipes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("recipe_id", name="uq_midjourney_generation_recipe"),
    )
    op.create_index("ix_midjourney_generations_status", "midjourney_generations", ["status"])
    op.create_index(
        "ix_midjourney_generations_discord_channel_id",
        "midjourney_generations",
        ["discord_channel_id"],
    )
    op.create_index(
        "ix_midjourney_generations_tracked_message_id",
        "midjourney_generations",
        ["tracked_message_id"],
    )
    op.create_index(
        "ix_midjourney_generations_grid_message_id",
        "midjourney_generations",
        ["grid_message_id"],
    )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "midjourney_generations" in inspector.get_table_names():
        op.drop_table("midjourney_generations")
