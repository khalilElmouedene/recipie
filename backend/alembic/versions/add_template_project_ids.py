"""add project_ids to pin_designer_templates

Revision ID: add_template_project_ids
Revises: add_threads_project_credentials
Create Date: 2026-04-06
"""

from alembic import op
import sqlalchemy as sa

revision = "add_template_project_ids"
down_revision = "add_threads_project_credentials"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "pin_designer_templates",
        sa.Column("project_ids", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("pin_designer_templates", "project_ids")
