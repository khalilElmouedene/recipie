"""add Page-scoped Facebook generation settings and video variants

Revision ID: add_fb_page_generation
Revises: use_reel_video_default
Create Date: 2026-08-07
"""

from alembic import op
import sqlalchemy as sa


revision = "add_fb_page_generation"
down_revision = "use_reel_video_default"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    page_columns = {
        column["name"] for column in inspector.get_columns("facebook_pages")
    }
    if "tts_voice" not in page_columns:
        op.add_column(
            "facebook_pages",
            sa.Column(
                "tts_voice",
                sa.String(length=32),
                nullable=False,
                server_default=sa.text("'nova'"),
            ),
        )
    if "recipe_card_prompt" not in page_columns:
        op.add_column(
            "facebook_pages",
            sa.Column("recipe_card_prompt", sa.Text(), nullable=True),
        )
    if "recipe_card_model" not in page_columns:
        op.add_column(
            "facebook_pages",
            sa.Column(
                "recipe_card_model",
                sa.String(length=64),
                nullable=False,
                server_default=sa.text("'gpt-image-2'"),
            ),
        )
    if "recipe_card_quality" not in page_columns:
        op.add_column(
            "facebook_pages",
            sa.Column(
                "recipe_card_quality",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'low'"),
            ),
        )

    delivery_columns = {
        column["name"] for column in inspector.get_columns("facebook_deliveries")
    }
    if "processed_video_url" not in delivery_columns:
        op.add_column(
            "facebook_deliveries",
            sa.Column("processed_video_url", sa.Text(), nullable=True),
        )

    # Preserve an existing project-level recipe-card customization by copying
    # it to every Page before the UI stops exposing that project-level field.
    if bind.dialect.name == "postgresql":
        op.execute(
            sa.text(
                """
                UPDATE facebook_pages AS page
                SET recipe_card_prompt = prompt.value
                FROM facebook_projects AS facebook_project
                JOIN prompts AS prompt
                  ON prompt.project_id = facebook_project.content_project_id
                 AND prompt.key = 'facebook_recipe_card'
                WHERE facebook_project.id = page.project_id
                  AND page.recipe_card_prompt IS NULL
                """
            )
        )


def downgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    delivery_columns = {
        column["name"] for column in inspector.get_columns("facebook_deliveries")
    }
    if "processed_video_url" in delivery_columns:
        op.drop_column("facebook_deliveries", "processed_video_url")

    page_columns = {
        column["name"] for column in inspector.get_columns("facebook_pages")
    }
    if "recipe_card_quality" in page_columns:
        op.drop_column("facebook_pages", "recipe_card_quality")
    if "recipe_card_model" in page_columns:
        op.drop_column("facebook_pages", "recipe_card_model")
    if "recipe_card_prompt" in page_columns:
        op.drop_column("facebook_pages", "recipe_card_prompt")
    if "tts_voice" in page_columns:
        op.drop_column("facebook_pages", "tts_voice")
