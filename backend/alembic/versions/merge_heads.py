"""merge heads

Revision ID: merge_heads
Revises: add_site_image_mode, add_audit_logs
Create Date: 2026-04-18

"""
from alembic import op

revision = "merge_heads"
down_revision = ("add_site_image_mode", "add_audit_logs")
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
