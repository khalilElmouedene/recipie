"""Add Facebook voice/recipe template settings and post stats tracking columns."""
from alembic import op
import sqlalchemy as sa

revision = "add_fb_voice_recipe_stats"
down_revision = "add_job_image_provider"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    fb_project_cols = {column["name"] for column in inspector.get_columns("facebook_projects")}
    if "voice_recipe_mode" not in fb_project_cols:
        op.add_column(
            "facebook_projects",
            sa.Column("voice_recipe_mode", sa.String(32), nullable=False, server_default="per_page"),
        )
    if "shared_tts_voice" not in fb_project_cols:
        op.add_column(
            "facebook_projects",
            sa.Column("shared_tts_voice", sa.String(32), nullable=False, server_default="nova"),
        )
    if "shared_recipe_card_prompt" not in fb_project_cols:
        op.add_column(
            "facebook_projects",
            sa.Column("shared_recipe_card_prompt", sa.Text(), nullable=True),
        )
    if "shared_recipe_card_model" not in fb_project_cols:
        op.add_column(
            "facebook_projects",
            sa.Column("shared_recipe_card_model", sa.String(64), nullable=False, server_default="gpt-image-2"),
        )
    if "shared_recipe_card_quality" not in fb_project_cols:
        op.add_column(
            "facebook_projects",
            sa.Column("shared_recipe_card_quality", sa.String(16), nullable=False, server_default="low"),
        )

    fb_delivery_cols = {column["name"] for column in inspector.get_columns("facebook_deliveries")}
    for col_name in ("views_count", "likes_count", "comments_count", "shares_count"):
        if col_name not in fb_delivery_cols:
            op.add_column(
                "facebook_deliveries",
                sa.Column(col_name, sa.Integer(), nullable=False, server_default="0"),
            )
    if "stats_checked_at" not in fb_delivery_cols:
        op.add_column(
            "facebook_deliveries",
            sa.Column("stats_checked_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade():
    op.drop_column("facebook_deliveries", "stats_checked_at")
    op.drop_column("facebook_deliveries", "shares_count")
    op.drop_column("facebook_deliveries", "comments_count")
    op.drop_column("facebook_deliveries", "likes_count")
    op.drop_column("facebook_deliveries", "views_count")
    op.drop_column("facebook_projects", "shared_recipe_card_quality")
    op.drop_column("facebook_projects", "shared_recipe_card_model")
    op.drop_column("facebook_projects", "shared_recipe_card_prompt")
    op.drop_column("facebook_projects", "shared_tts_voice")
    op.drop_column("facebook_projects", "voice_recipe_mode")
