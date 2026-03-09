"""add prompts table for configurable AI prompts

Revision ID: add_prompts_table
Revises: add_recipe_pin_fields
Create Date: 2026-03-03

"""
from alembic import op
import sqlalchemy as sa

revision = "add_prompts_table"
down_revision = "add_recipe_pin_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.has_table(bind, "prompts"):
        return
    op.create_table(
        "prompts",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("prompts")
