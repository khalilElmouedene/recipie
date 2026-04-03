"""add app_id and app_secret to threads_projects

Revision ID: add_threads_project_credentials
Revises: add_threads_media_urls
Create Date: 2026-04-03
"""

from alembic import op
import sqlalchemy as sa

revision = "add_threads_project_credentials"
down_revision = "add_threads_media_urls"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("threads_projects", sa.Column("app_id", sa.String(255), nullable=True))
    op.add_column("threads_projects", sa.Column("app_secret", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("threads_projects", "app_secret")
    op.drop_column("threads_projects", "app_id")
