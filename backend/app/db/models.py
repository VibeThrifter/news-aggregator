"""SQLAlchemy models for persistent storage."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict

from sqlalchemy import JSON, Column, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base declarative class."""


def utcnow() -> datetime:
    """Timezone-aware UTC timestamp for default values."""
    return datetime.now(timezone.utc)


class Article(Base):
    """Persisted article content fetched from feeds."""

    __tablename__ = "articles"
    __table_args__ = (
        UniqueConstraint("url", name="uq_articles_url"),
        UniqueConstraint("guid", name="uq_articles_guid"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    guid: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_metadata: Mapped[Dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<Article id={self.id} url={self.url!r}>"
