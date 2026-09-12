"""Website-scoped credentials and durable Pinterest publication history."""
from __future__ import annotations

import uuid
from datetime import datetime
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from .database import Base
from .db_models import _new_uuid, _utcnow


class PinterestPublisher(Base):
    __tablename__ = "pinterest_publishers"
    __table_args__ = (
        CheckConstraint("daily_limit BETWEEN 1 AND 1000", name="ck_pinterest_daily_limit"),
        CheckConstraint("interval_minutes BETWEEN 1 AND 10080", name="ck_pinterest_interval"),
    )
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    username: Mapped[str | None] = mapped_column(String(200))
    client_id: Mapped[str | None] = mapped_column(String(100))
    app_secret_encrypted: Mapped[str | None] = mapped_column(Text)
    access_token_encrypted: Mapped[str | None] = mapped_column(Text)
    refresh_token_encrypted: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    refresh_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    daily_limit: Mapped[int] = mapped_column(Integer, default=10, server_default="10")
    interval_minutes: Mapped[int] = mapped_column(Integer, default=60, server_default="60")
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(Text)


class PinterestOAuthState(Base):
    __tablename__ = "pinterest_oauth_states"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class PinterestPublication(Base):
    __tablename__ = "pinterest_publications"
    __table_args__ = (
        UniqueConstraint("site_id", "recipe_id", name="uq_pinterest_site_recipe"),
        CheckConstraint("status IN ('pending','publishing','published','failed')", name="ck_pinterest_status"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    site_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), index=True)
    # Intentionally no recipe FK: deleting a recipe must retain its publication history.
    recipe_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str] = mapped_column(Text)
    board_name: Mapped[str] = mapped_column(Text)
    keywords: Mapped[str] = mapped_column(Text)
    article_url: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending", index=True)
    board_id: Mapped[str | None] = mapped_column(String(100))
    pin_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    retry_safe: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
