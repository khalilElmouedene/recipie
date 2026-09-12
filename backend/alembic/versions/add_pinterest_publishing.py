"""Website-scoped Pinterest OAuth, schedule and publication history.

Revision ID: add_pinterest_publishing
Revises: add_image_batches
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "add_pinterest_publishing"
down_revision = "add_image_batches"
branch_labels = None
depends_on = None


def upgrade():
    # The application also creates missing tables at startup. Support both orders.
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "pinterest_publishers" not in tables:
        op.create_table("pinterest_publishers",
            sa.Column("site_id", UUID(as_uuid=True), sa.ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("username", sa.String(200)),
            sa.Column("access_token_encrypted", sa.Text()),
            sa.Column("refresh_token_encrypted", sa.Text()),
            sa.Column("token_expires_at", sa.DateTime(timezone=True)),
            sa.Column("refresh_expires_at", sa.DateTime(timezone=True)),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("daily_limit", sa.Integer(), nullable=False, server_default="10"),
            sa.Column("interval_minutes", sa.Integer(), nullable=False, server_default="60"),
            sa.Column("last_attempt_at", sa.DateTime(timezone=True)),
            sa.Column("last_error", sa.Text()),
            sa.CheckConstraint("daily_limit BETWEEN 1 AND 1000", name="ck_pinterest_daily_limit"),
            sa.CheckConstraint("interval_minutes BETWEEN 1 AND 10080", name="ck_pinterest_interval"))
    if "pinterest_oauth_states" not in tables:
        op.create_table("pinterest_oauth_states",
            sa.Column("token_hash", sa.String(64), primary_key=True),
            sa.Column("site_id", UUID(as_uuid=True), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
        op.create_index("ix_pinterest_oauth_states_expires_at", "pinterest_oauth_states", ["expires_at"])
    if "pinterest_publications" not in tables:
        op.create_table("pinterest_publications",
            sa.Column("id", UUID(as_uuid=True), primary_key=True),
            sa.Column("site_id", UUID(as_uuid=True), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
            sa.Column("recipe_id", UUID(as_uuid=True), nullable=False),
            *[sa.Column(name, sa.Text(), nullable=False) for name in
                ("title", "description", "board_name", "keywords", "article_url", "image_url")],
            sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
            sa.Column("board_id", sa.String(100)),
            sa.Column("pin_id", sa.String(100), unique=True),
            sa.Column("published_at", sa.DateTime(timezone=True)),
            sa.Column("attempted_at", sa.DateTime(timezone=True)),
            sa.Column("dispatched_at", sa.DateTime(timezone=True)),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("retry_safe", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("next_retry_at", sa.DateTime(timezone=True)),
            sa.Column("error", sa.Text()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("site_id", "recipe_id", name="uq_pinterest_site_recipe"),
            sa.CheckConstraint("status IN ('pending','publishing','published','failed')", name="ck_pinterest_status"))
        for column in ("site_id", "status"):
            op.create_index(f"ix_pinterest_publications_{column}", "pinterest_publications", [column])


def downgrade():
    op.drop_table("pinterest_publications")
    op.drop_table("pinterest_oauth_states")
    op.drop_table("pinterest_publishers")
