from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin

if TYPE_CHECKING:
    from app.domains.assets.models import Asset
    from app.domains.books.models import Book


class CharacterBibleEntry(IdMixin, TimestampMixin, Base):
    """角色规范表，保存后续一致性检查可直接消费的硬规则。"""

    __tablename__ = "character_bible_entries"

    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), index=True, nullable=False)
    character_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id", ondelete="SET NULL"), index=True)
    canonical_name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    aliases: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    voice_traits: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    forbidden_traits: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    book: Mapped[Book] = relationship()
    character: Mapped[Asset | None] = relationship()
