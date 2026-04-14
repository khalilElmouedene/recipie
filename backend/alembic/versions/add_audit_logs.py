"""add audit_logs table

Revision ID: add_audit_logs
Revises: add_spy_sheets
Create Date: 2026-04-14
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision = "add_audit_logs"
down_revision = "add_spy_sheets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    if conn.dialect.has_table(conn, "audit_logs"):
        return

    op.create_table(
        "audit_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "actor_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("actor_email", sa.String(length=320), nullable=True),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("table_name", sa.String(length=120), nullable=False),
        sa.Column("entity_pk", sa.String(length=255), nullable=True),
        sa.Column("changed_fields", sa.JSON(), nullable=True),
        sa.Column("old_values", sa.JSON(), nullable=True),
        sa.Column("new_values", sa.JSON(), nullable=True),
        sa.Column("request_method", sa.String(length=10), nullable=True),
        sa.Column("request_path", sa.String(length=500), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
    )

    op.create_index("ix_audit_logs_occurred_at", "audit_logs", ["occurred_at"], unique=False)
    op.create_index("ix_audit_logs_actor_user_id", "audit_logs", ["actor_user_id"], unique=False)
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"], unique=False)
    op.create_index("ix_audit_logs_table_name", "audit_logs", ["table_name"], unique=False)
    op.create_index("ix_audit_logs_entity_pk", "audit_logs", ["entity_pk"], unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    if not conn.dialect.has_table(conn, "audit_logs"):
        return
    op.drop_index("ix_audit_logs_entity_pk", table_name="audit_logs")
    op.drop_index("ix_audit_logs_table_name", table_name="audit_logs")
    op.drop_index("ix_audit_logs_action", table_name="audit_logs")
    op.drop_index("ix_audit_logs_actor_user_id", table_name="audit_logs")
    op.drop_index("ix_audit_logs_occurred_at", table_name="audit_logs")
    op.drop_table("audit_logs")
