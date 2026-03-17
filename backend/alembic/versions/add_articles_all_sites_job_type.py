"""add articles_all_sites job type

Revision ID: add_articles_all_sites_job_type
Revises: add_user_custom_fonts
Create Date: 2026-03-14

"""
from alembic import op

revision = "add_articles_all_sites_job_type"
down_revision = "add_user_custom_fonts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE job_type_enum ADD VALUE IF NOT EXISTS 'articles_all_sites'")


def downgrade() -> None:
    # PostgreSQL enum value removal is not trivial and can break existing rows.
    # We keep downgrade as no-op for safety.
    pass
