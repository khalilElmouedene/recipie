"""add recipe pin fields (pin_design_image, pin_title, pin_description, pin_blog_link)

Revision ID: add_recipe_pin_fields
Revises: add_user_credentials
Create Date: 2026-02-24

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "add_recipe_pin_fields"
down_revision = "add_user_credentials"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    existing = [c["name"] for c in inspect(conn).get_columns("recipes")]
    if "pin_design_image" not in existing:
        op.add_column("recipes", sa.Column("pin_design_image", sa.Text(), nullable=True))
    if "pin_title" not in existing:
        op.add_column("recipes", sa.Column("pin_title", sa.String(500), nullable=True))
    if "pin_description" not in existing:
        op.add_column("recipes", sa.Column("pin_description", sa.Text(), nullable=True))
    if "pin_blog_link" not in existing:
        op.add_column("recipes", sa.Column("pin_blog_link", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("recipes", "pin_blog_link")
    op.drop_column("recipes", "pin_description")
    op.drop_column("recipes", "pin_title")
    op.drop_column("recipes", "pin_design_image")
