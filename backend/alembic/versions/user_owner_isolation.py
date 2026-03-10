"""user owner isolation: created_by_owner_id on users, per-owner prompts table

Revision ID: user_owner_isolation
Revises: aabbcc112233
Create Date: 2026-03-10

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "user_owner_isolation"
down_revision = "aabbcc112233"
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c"
        ),
        {"t": table, "c": column},
    )
    return result.fetchone() is not None


def upgrade() -> None:
    # 1. Add created_by_owner_id to users (nullable self-FK)
    if not _column_exists("users", "created_by_owner_id"):
        op.add_column(
            "users",
            sa.Column(
                "created_by_owner_id",
                UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )

    # 2. Recreate prompts table with per-owner schema
    #    Check if the new schema is already in place by looking for owner_id column
    if not _column_exists("prompts", "owner_id"):
        op.drop_table("prompts")
        op.create_table(
            "prompts",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "owner_id",
                UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("key", sa.String(100), nullable=False),
            sa.Column("value", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True, server_default=""),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_unique_constraint(
            "uq_owner_prompt_key", "prompts", ["owner_id", "key"]
        )


def downgrade() -> None:
    # Restore old prompts table (data loss)
    op.drop_table("prompts")
    op.create_table(
        "prompts",
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.drop_column("users", "created_by_owner_id")
