from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.domains.book_runs.schemas import BookRunCreate, BookRunRead

WritingRunScope = Literal["paragraph", "scene", "chapter", "short_story", "volume", "full_book", "revision"]
WritingRunMode = Literal["inline", "managed"]


class WritingRunStart(BaseModel):
    """Canonical start request for an author-facing writing IDE task."""

    scope: WritingRunScope
    mode: WritingRunMode
    book_id: int = Field(gt=0)
    blueprint_id: int = Field(gt=0)
    token_budget: int | None = Field(default=None, gt=0)
    time_budget_sec: int | None = Field(default=None, gt=0)
    chapter_budget: int | None = Field(default=None, gt=0)

    @classmethod
    def from_book_run_create(cls, payload: BookRunCreate) -> WritingRunStart:
        return cls(
            scope="full_book",
            mode="managed",
            book_id=payload.book_id,
            blueprint_id=payload.blueprint_id,
            token_budget=payload.token_budget,
            time_budget_sec=payload.time_budget_sec,
            chapter_budget=payload.chapter_budget,
        )

    def to_book_run_create(self) -> BookRunCreate:
        return BookRunCreate(
            book_id=self.book_id,
            blueprint_id=self.blueprint_id,
            token_budget=self.token_budget,
            time_budget_sec=self.time_budget_sec,
            chapter_budget=self.chapter_budget,
        )


class WritingRunHandle(BaseModel):
    """Canonical run handle while BookRun remains the full-book storage adapter."""

    writing_run_id: int
    scope: WritingRunScope
    mode: WritingRunMode
    status: str
    book_run_id: int
    book_run: BookRunRead
