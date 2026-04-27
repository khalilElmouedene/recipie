"""merge pw reset token type and site pin template heads

Revision ID: merge_pw_reset_site_pin_tmpl
Revises: add_pw_reset_token_type, add_site_pin_template
Create Date: 2026-04-27

"""
from alembic import op
import sqlalchemy as sa

revision = "merge_pw_reset_site_pin_tmpl"
down_revision = ("add_pw_reset_token_type", "add_site_pin_template")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
