"""add pin_url to recipes

Revision ID: add_recipe_pin_url
Revises: add_threads_project_credentials
Create Date: 2026-04-03
"""

from alembic import op
import sqlalchemy as sa

revision = "add_recipe_pin_url"
down_revision = "add_threads_project_credentials"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("recipes", sa.Column("pin_url", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("recipes", "pin_url")
