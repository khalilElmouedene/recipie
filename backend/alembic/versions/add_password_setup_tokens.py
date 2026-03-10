"""add password_setup_tokens table for invite-by-email flow

Revision ID: aabbcc112233
Revises: add_prompts_table
Create Date: 2026-03-09

"""
from alembic import op
import sqlalchemy as sa

revision = "aabbcc112233"
down_revision = "add_google_oauth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.has_table(bind, "password_setup_tokens"):
        return
    op.create_table(
        "password_setup_tokens",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_password_setup_tokens_token_hash",
        "password_setup_tokens",
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_password_setup_tokens_token_hash", table_name="password_setup_tokens")
    op.drop_table("password_setup_tokens")
