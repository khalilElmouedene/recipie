"""add pin_tags to recipes

Revision ID: add_recipe_pin_tags
Revises: add_recipe_pin_board
Create Date: 2026-04-03
"""

from alembic import op
import sqlalchemy as sa

revision = "add_recipe_pin_tags"
down_revision = "add_recipe_pin_board"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("recipes", sa.Column("pin_tags", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("recipes", "pin_tags")
