"""add wp_users_enc for multiple WP users per site

Revision ID: add_site_wp_users
Revises: add_prompts_table
Create Date: 2026-03-03

"""
import json
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "add_site_wp_users"
down_revision = "add_prompts_table"
branch_labels = None
depends_on = None


def _has_column(conn, table: str, column: str) -> bool:
    cols = [c["name"] for c in inspect(conn).get_columns(table)]
    return column in cols


def upgrade() -> None:
    conn = op.get_bind()
    if not _has_column(conn, "sites", "wp_users_enc"):
        op.add_column("sites", sa.Column("wp_users_enc", sa.Text(), nullable=True))
    op.alter_column("sites", "wp_username", nullable=True)
    op.alter_column("sites", "wp_password_enc", nullable=True)

    rows = conn.execute(
        text("SELECT id, wp_username, wp_password_enc FROM sites WHERE wp_users_enc IS NULL AND wp_username IS NOT NULL AND wp_password_enc IS NOT NULL")
    ).fetchall()
    for row in rows:
        wp_users_enc = json.dumps([{"username": row[1], "password_enc": row[2]}])
        conn.execute(
            text("UPDATE sites SET wp_users_enc = :enc WHERE id = :id"),
            {"enc": wp_users_enc, "id": str(row[0])},
        )


def downgrade() -> None:
    op.drop_column("sites", "wp_users_enc")
    op.alter_column("sites", "wp_username", nullable=False)
    op.alter_column("sites", "wp_password_enc", nullable=False)
