"""add generate_recipe_json option to sites

Revision ID: add_site_generate_recipe_json
Revises: add_site_publish_schedules
Create Date: 2026-05-11

"""
from alembic import op
import sqlalchemy as sa

revision = "add_site_generate_recipe_json"
down_revision = "add_site_publish_schedules"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("sites")]
    if "generate_recipe_json" not in cols:
        op.add_column(
            "sites",
            sa.Column("generate_recipe_json", sa.Boolean(), nullable=False, server_default="true"),
        )


def downgrade():
    bind = op.get_bind()
    cols = [c["name"] for c in sa.inspect(bind).get_columns("sites")]
    if "generate_recipe_json" in cols:
        op.drop_column("sites", "generate_recipe_json")
