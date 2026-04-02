"""add canvas_width and canvas_height to pin_designer_templates

Revision ID: add_template_canvas_size
Revises: add_pin_templates_min_ret
Create Date: 2026-04-02
"""

from alembic import op
import sqlalchemy as sa

revision = "add_template_canvas_size"
down_revision = "add_pin_templates_min_ret"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "pin_designer_templates",
        sa.Column("canvas_width", sa.Integer(), nullable=False, server_default="1000"),
    )
    op.add_column(
        "pin_designer_templates",
        sa.Column("canvas_height", sa.Integer(), nullable=False, server_default="1500"),
    )


def downgrade():
    op.drop_column("pin_designer_templates", "canvas_height")
    op.drop_column("pin_designer_templates", "canvas_width")
