from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CharacterBibleCreate(BaseModel):
    """创建角色规范时提供的最小硬规则。"""

    book_id: int = Field(gt=0)
    character_id: int | None = Field(default=None, gt=0)
    canonical_name: str = Field(min_length=1, max_length=255)
    aliases: list[str] = Field(default_factory=list, max_length=100)
    voice_traits: dict[str, Any] = Field(default_factory=dict)
    forbidden_traits: dict[str, Any] = Field(default_factory=dict)


class CharacterBibleUpdate(BaseModel):
    """更新角色规范；未提供字段保持原值。"""

    character_id: int | None = Field(default=None, gt=0)
    canonical_name: str | None = Field(default=None, min_length=1, max_length=255)
    aliases: list[str] | None = Field(default=None, max_length=100)
    voice_traits: dict[str, Any] | None = None
    forbidden_traits: dict[str, Any] | None = None

    @model_validator(mode="after")
    def reject_empty_update(self) -> CharacterBibleUpdate:
        """空更新不会产生新状态，直接拒绝。"""

        if not self.model_fields_set:
            raise ValueError("Character Bible 更新内容不能为空。")
        return self


class CharacterBibleRead(BaseModel):
    """角色规范响应契约。"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    book_id: int
    character_id: int | None
    canonical_name: str
    aliases: list[str]
    voice_traits: dict[str, Any]
    forbidden_traits: dict[str, Any]
    created_at: datetime
    updated_at: datetime
