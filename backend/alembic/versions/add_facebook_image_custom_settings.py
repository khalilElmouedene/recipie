"""add Facebook image recipe rewrite and post header settings

Revision ID: add_fb_image_custom_settings
Revises: add_fb_image_posts
Create Date: 2026-08-10
"""

from alembic import op
import sqlalchemy as sa


revision = "add_fb_image_custom_settings"
down_revision = "add_fb_image_posts"
branch_labels = None
depends_on = None


def _columns(inspector, table: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    project_columns = _columns(inspector, "facebook_projects")
    if "recipe_rewrite_prompt" not in project_columns:
        op.add_column(
            "facebook_projects",
            sa.Column("recipe_rewrite_prompt", sa.Text(), nullable=True),
        )

    page_columns = _columns(inspector, "facebook_pages")
    if "post_header_mode" not in page_columns:
        op.add_column(
            "facebook_pages",
            sa.Column(
                "post_header_mode",
                sa.String(length=32),
                nullable=False,
                server_default=sa.text("'recipe_title'"),
            ),
        )

    content_columns = _columns(inspector, "facebook_contents")
    if "rewritten_recipe_post" not in content_columns:
        op.add_column(
            "facebook_contents",
            sa.Column("rewritten_recipe_post", sa.Text(), nullable=True),
        )
    if "recipe_title" not in content_columns:
        op.add_column(
            "facebook_contents",
            sa.Column("recipe_title", sa.String(length=500), nullable=True),
        )
    if "ingredient_recipe" not in content_columns:
        op.add_column(
            "facebook_contents",
            sa.Column("ingredient_recipe", sa.Text(), nullable=True),
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    content_columns = _columns(inspector, "facebook_contents")
    for name in ("ingredient_recipe", "recipe_title", "rewritten_recipe_post"):
        if name in content_columns:
            op.drop_column("facebook_contents", name)
    page_columns = _columns(inspector, "facebook_pages")
    if "post_header_mode" in page_columns:
        op.drop_column("facebook_pages", "post_header_mode")
    project_columns = _columns(inspector, "facebook_projects")
    if "recipe_rewrite_prompt" in project_columns:
        op.drop_column("facebook_projects", "recipe_rewrite_prompt")

