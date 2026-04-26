"""add pin_template_id to sites and auto_spy_generate job type

Revision ID: add_site_pin_template
Revises: add_auto_spy
Create Date: 2026-04-26
"""
from alembic import op
import sqlalchemy as sa

revision = "add_site_pin_template"
down_revision = "add_auto_spy"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # Add pin_template_id to sites table
    result = conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name='sites' AND column_name='pin_template_id'"
    ))
    if not result.fetchone():
        op.add_column("sites", sa.Column("pin_template_id", sa.String(200), nullable=True))

    # Add auto_spy_generate value to the job_type_enum PostgreSQL enum.
    # The DO block is idempotent; the ALTER TYPE runs outside the implicit
    # transaction only when pg_enum doesn't already have the label.
    conn.execute(sa.text(
        "DO $$ BEGIN "
        "  IF NOT EXISTS ("
        "    SELECT 1 FROM pg_enum "
        "    WHERE enumtypid = 'job_type_enum'::regtype "
        "    AND enumlabel = 'auto_spy_generate'"
        "  ) THEN "
        "    ALTER TYPE job_type_enum ADD VALUE 'auto_spy_generate'; "
        "  END IF; "
        "END $$"
    ))


def downgrade():
    op.drop_column("sites", "pin_template_id")
    # PostgreSQL does not support removing enum values; leave the enum value in place.
