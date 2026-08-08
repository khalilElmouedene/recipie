"""add Facebook image-post projects and assets

Revision ID: add_fb_image_posts
Revises: add_mj_generation_tracking
Create Date: 2026-08-08
"""

from alembic import op
import sqlalchemy as sa


revision = "add_fb_image_posts"
down_revision = "add_mj_generation_tracking"
branch_labels = None
depends_on = None


def _columns(inspector, table: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    project_columns = _columns(inspector, "facebook_projects")
    if "post_type" not in project_columns:
        op.add_column(
            "facebook_projects",
            sa.Column(
                "post_type",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'video'"),
            ),
        )

    spy_columns = _columns(inspector, "facebook_spy_rows")
    for name in ("template_image_url", "source_image_url", "recipe_post"):
        if name not in spy_columns:
            op.add_column("facebook_spy_rows", sa.Column(name, sa.Text(), nullable=True))

    content_columns = _columns(inspector, "facebook_contents")
    if "post_type" not in content_columns:
        op.add_column(
            "facebook_contents",
            sa.Column(
                "post_type",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'video'"),
            ),
        )
    for name in ("template_image_url", "source_image_url", "recipe_post"):
        if name not in content_columns:
            op.add_column("facebook_contents", sa.Column(name, sa.Text(), nullable=True))
    if "generate_article" not in content_columns:
        op.add_column(
            "facebook_contents",
            sa.Column(
                "generate_article",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )

    delivery_columns = _columns(inspector, "facebook_deliveries")
    if "generated_image_url" not in delivery_columns:
        op.add_column(
            "facebook_deliveries",
            sa.Column("generated_image_url", sa.Text(), nullable=True),
        )
    if "allow_without_article_url" not in delivery_columns:
        op.add_column(
            "facebook_deliveries",
            sa.Column(
                "allow_without_article_url",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    delivery_columns = _columns(inspector, "facebook_deliveries")
    for name in ("allow_without_article_url", "generated_image_url"):
        if name in delivery_columns:
            op.drop_column("facebook_deliveries", name)
    content_columns = _columns(inspector, "facebook_contents")
    for name in (
        "generate_article",
        "recipe_post",
        "source_image_url",
        "template_image_url",
        "post_type",
    ):
        if name in content_columns:
            op.drop_column("facebook_contents", name)
    spy_columns = _columns(inspector, "facebook_spy_rows")
    for name in ("recipe_post", "source_image_url", "template_image_url"):
        if name in spy_columns:
            op.drop_column("facebook_spy_rows", name)
    project_columns = _columns(inspector, "facebook_projects")
    if "post_type" in project_columns:
        op.drop_column("facebook_projects", "post_type")
