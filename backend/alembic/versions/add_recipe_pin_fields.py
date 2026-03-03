"""add recipe pin fields (pin_design_image, pin_title, pin_description, pin_blog_link)

Revision ID: add_recipe_pin_fields
Revises: add_user_credentials
Create Date: 2026-02-24

"""
from alembic import op
import sqlalchemy as sa

revision = "add_recipe_pin_fields"
down_revision = "add_user_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("recipes", sa.Column("pin_design_image", sa.Text(), nullable=True))
    op.add_column("recipes", sa.Column("pin_title", sa.String(500), nullable=True))
    op.add_column("recipes", sa.Column("pin_description", sa.Text(), nullable=True))
    op.add_column("recipes", sa.Column("pin_blog_link", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("recipes", "pin_blog_link")
    op.drop_column("recipes", "pin_description")
    op.drop_column("recipes", "pin_title")
    op.drop_column("recipes", "pin_design_image")
