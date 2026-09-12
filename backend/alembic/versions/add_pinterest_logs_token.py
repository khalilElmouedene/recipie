"""Persistent publishing activity and manually supplied access tokens."""
from alembic import op
import sqlalchemy as sa

revision = "add_pinterest_logs_token"
down_revision = "add_pinterest_app_credentials"
branch_labels = None
depends_on = None


def upgrade():
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("pinterest_publishers")}
    if "connection_method" not in columns:
        op.add_column("pinterest_publishers", sa.Column("connection_method", sa.String(16), nullable=False, server_default="oauth"))
    if not sa.inspect(op.get_bind()).has_table("pinterest_publishing_logs"):
        op.create_table("pinterest_publishing_logs",
            sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
            sa.Column("site_id", sa.UUID(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("publication_id", sa.UUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("level", sa.String(16), nullable=False),
            sa.Column("event", sa.String(64), nullable=False),
            sa.Column("message", sa.Text(), nullable=False))
        op.create_index("ix_pinterest_publishing_logs_site_id", "pinterest_publishing_logs", ["site_id"])


def downgrade():
    op.drop_table("pinterest_publishing_logs")
    op.drop_column("pinterest_publishers", "connection_method")
