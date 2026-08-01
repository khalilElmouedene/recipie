"""add Facebook projects, pages, spy sheet, generated content and deliveries

Revision ID: add_facebook_module
Revises: add_spy_sheet_sources
Create Date: 2026-07-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "add_facebook_module"
down_revision = "add_spy_sheet_sources"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()

    # The container intentionally runs Base.metadata.create_all() before Alembic
    # so a fresh installation has the original baseline schema. Existing
    # migrations therefore treat tables created from current metadata as
    # already applied. Keep the Facebook migration consistent with that
    # bootstrap strategy instead of attempting to create the same tables twice.
    facebook_tables = {
        "facebook_projects",
        "facebook_pages",
        "facebook_spy_rows",
        "facebook_contents",
        "facebook_deliveries",
    }
    existing_tables = {
        table_name
        for table_name in facebook_tables
        if bind.dialect.has_table(bind, table_name)
    }
    if existing_tables:
        if existing_tables != facebook_tables:
            missing = ", ".join(sorted(facebook_tables - existing_tables))
            raise RuntimeError(
                "Partial Facebook schema detected; missing tables: " + missing
            )
        return

    comment_mode = postgresql.ENUM(
        "full_recipe", "full_recipe_url", name="facebook_comment_mode"
    )
    content_status = postgresql.ENUM(
        "processing", "ready", "failed", name="facebook_content_status"
    )
    delivery_status = postgresql.ENUM(
        "processing", "draft", "scheduled", "publishing", "published", "failed",
        name="facebook_delivery_status",
    )
    comment_mode.create(bind, checkfirst=True)
    content_status.create(bind, checkfirst=True)
    delivery_status.create(bind, checkfirst=True)

    op.create_table(
        "facebook_projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "content_project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("app_id", sa.String(255), nullable=True),
        sa.Column("app_secret", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_facebook_projects_owner_id", "facebook_projects", ["owner_id"])
    op.create_index(
        "ix_facebook_projects_content_project_id",
        "facebook_projects",
        ["content_project_id"],
        unique=True,
    )

    op.create_table(
        "facebook_pages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("facebook_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("facebook_page_id", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("picture_url", sa.Text(), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=False),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "comment_mode",
            postgresql.ENUM(name="facebook_comment_mode", create_type=False),
            nullable=False,
            server_default="full_recipe",
        ),
        sa.Column("publish_start_time", sa.String(5), nullable=False, server_default="12:00"),
        sa.Column("publish_end_time", sa.String(5), nullable=False, server_default="19:00"),
        sa.Column("max_posts_per_day", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("interval_minutes", sa.Integer(), nullable=False, server_default="180"),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "facebook_page_id", name="uq_facebook_project_page"),
    )
    op.create_index("ix_facebook_pages_project_id", "facebook_pages", ["project_id"])

    op.create_table(
        "facebook_spy_rows",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("facebook_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("direct_link", sa.Text(), nullable=False),
        sa.Column("post_title", sa.String(500), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_facebook_spy_rows_project_id", "facebook_spy_rows", ["project_id"])

    op.create_table(
        "facebook_contents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("facebook_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "recipe_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("recipes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("source_video_url", sa.Text(), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("screenshot_url", sa.Text(), nullable=True),
        sa.Column("processed_video_url", sa.Text(), nullable=True),
        sa.Column("generated_images", sa.Text(), nullable=True),
        sa.Column("generated_article", sa.Text(), nullable=True),
        sa.Column("article_url", sa.Text(), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM(name="facebook_content_status", create_type=False),
            nullable=False,
            server_default="processing",
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_facebook_contents_project_id", "facebook_contents", ["project_id"])
    op.create_index("ix_facebook_contents_recipe_id", "facebook_contents", ["recipe_id"])

    op.create_table(
        "facebook_deliveries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "content_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("facebook_contents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "page_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("facebook_pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(name="facebook_delivery_status", create_type=False),
            nullable=False,
            server_default="processing",
        ),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("facebook_post_id", sa.String(255), nullable=True),
        sa.Column("first_comment_id", sa.String(255), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("content_id", "page_id", name="uq_facebook_content_page"),
    )
    op.create_index("ix_facebook_deliveries_content_id", "facebook_deliveries", ["content_id"])
    op.create_index("ix_facebook_deliveries_page_id", "facebook_deliveries", ["page_id"])
    op.create_index("ix_facebook_deliveries_scheduled_at", "facebook_deliveries", ["scheduled_at"])


def downgrade():
    op.drop_table("facebook_deliveries")
    op.drop_table("facebook_contents")
    op.drop_table("facebook_spy_rows")
    op.drop_table("facebook_pages")
    op.drop_table("facebook_projects")

    bind = op.get_bind()
    postgresql.ENUM(name="facebook_delivery_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="facebook_content_status").drop(bind, checkfirst=True)
    postgresql.ENUM(name="facebook_comment_mode").drop(bind, checkfirst=True)
