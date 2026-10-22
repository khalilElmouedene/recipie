"""Persist the image provider so interrupted article jobs resume correctly."""
from alembic import op
import sqlalchemy as sa

revision = "add_job_image_provider"
down_revision = "add_fb_optional_midjourney"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("jobs")}
    if "image_provider" not in columns:
        op.add_column("jobs", sa.Column("image_provider", sa.String(32), nullable=False, server_default="midjourney"))


def downgrade():
    op.drop_column("jobs", "image_provider")
