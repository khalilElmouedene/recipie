"""Allow website-specific Pinterest app credentials to be managed securely.

Revision ID: add_pinterest_app_credentials
Revises: add_pinterest_publishing
"""
from alembic import op
import sqlalchemy as sa

revision = "add_pinterest_app_credentials"
down_revision = "add_pinterest_publishing"
branch_labels = None
depends_on = None


def upgrade():
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("pinterest_publishers")}
    if "client_id" not in columns:
        op.add_column("pinterest_publishers", sa.Column("client_id", sa.String(100), nullable=True))
    if "app_secret_encrypted" not in columns:
        op.add_column("pinterest_publishers", sa.Column("app_secret_encrypted", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("pinterest_publishers", "app_secret_encrypted")
    op.drop_column("pinterest_publishers", "client_id")
