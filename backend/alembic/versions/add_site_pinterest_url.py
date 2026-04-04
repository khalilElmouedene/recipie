"""add pinterest_url to sites

Revision ID: add_site_pinterest_url
Revises: add_recipe_seo_wp_tags
Create Date: 2026-04-04
"""

from alembic import op
import sqlalchemy as sa

revision = "add_site_pinterest_url"
down_revision = "add_recipe_seo_wp_tags"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("sites", sa.Column("pinterest_url", sa.String(500), nullable=True))


def downgrade():
    op.drop_column("sites", "pinterest_url")
