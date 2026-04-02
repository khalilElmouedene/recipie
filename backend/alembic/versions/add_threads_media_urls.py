"""add media_urls to threads_posts

Revision ID: add_threads_media_urls
Revises: add_template_canvas_size
Create Date: 2026-04-02
"""

from alembic import op
import sqlalchemy as sa

revision = "add_threads_media_urls"
down_revision = "add_template_canvas_size"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "threads_posts",
        sa.Column("media_urls", sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_column("threads_posts", "media_urls")
