from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class BookBlueprintCreate(BaseModel):
    book_id: int = Field(gt=0)
    premise: str = Field(min_length=1, max_length=10000)
    tone: str = Field(min_length=1, max_length=255)
    target_word_count: int = Field(ge=1)
    target_chapter_count: int = Field(ge=1, le=200)
    chapter_word_count_min: int = Field(ge=1)
    chapter_word_count_max: int = Field(ge=1)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_chapter_word_bounds(self) -> BookBlueprintCreate:
        """章节字数下限不能大于上限，避免 planner 输入自相矛盾。"""

        if self.chapter_word_count_min > self.chapter_word_count_max:
            raise ValueError("章节字数下限不能大于上限。")
        return self


class BookBlueprintRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    book_id: int
    premise: str
    tone: str
    target_word_count: int
    target_chapter_count: int
    chapter_word_count_min: int
    chapter_word_count_max: int
    status: str
    version: int
    metadata: dict[str, Any] = Field(validation_alias="metadata_", serialization_alias="metadata")
    created_at: datetime
    updated_at: datetime


class ChapterPlanTriggerRead(BaseModel):
    """章节规划触发结果只承诺已通过 locked 门禁，具体 planner 在后续步骤执行。"""

    blueprint_id: int
    book_id: int
    status: str
    chapter_count: int
