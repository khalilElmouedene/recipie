"""add pin_board to recipes

Revision ID: add_recipe_pin_board
Revises: add_recipe_pin_url
Create Date: 2026-04-03
"""

from alembic import op
import sqlalchemy as sa

revision = "add_recipe_pin_board"
down_revision = "add_recipe_pin_url"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("recipes", sa.Column("pin_board", sa.String(300), nullable=True))


def downgrade():
    op.drop_column("recipes", "pin_board")
