"""add seo_title and wp_tags to recipes

Revision ID: add_recipe_seo_wp_tags
Revises: add_recipe_pin_tags
Create Date: 2026-04-04
"""

from alembic import op
import sqlalchemy as sa

revision = "add_recipe_seo_wp_tags"
down_revision = "add_recipe_pin_tags"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("recipes", sa.Column("seo_title", sa.String(300), nullable=True))
    op.add_column("recipes", sa.Column("wp_tags", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("recipes", "seo_title")
    op.drop_column("recipes", "wp_tags")
