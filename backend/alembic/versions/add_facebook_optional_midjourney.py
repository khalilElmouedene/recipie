"""Allow Facebook projects to use video screenshots instead of Midjourney."""
from alembic import op
import sqlalchemy as sa

revision = "add_fb_optional_midjourney"
down_revision = ("add_fb_image_custom_settings", "add_pinterest_logs_token")
branch_labels = None
depends_on = None


def upgrade():
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("facebook_projects")}
    if "use_midjourney" not in columns:
        op.add_column(
            "facebook_projects",
            sa.Column("use_midjourney", sa.Boolean(), nullable=False, server_default=sa.true()),
        )


def downgrade():
    op.drop_column("facebook_projects", "use_midjourney")
