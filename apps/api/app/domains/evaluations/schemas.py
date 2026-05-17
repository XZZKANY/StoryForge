from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class EvaluationCaseCreate(BaseModel):
    workspace_id: int | None = Field(default=None, gt=0)
    book_id: int | None = Field(default=None, gt=0)
    case_name: str = Field(min_length=1, max_length=255)
    case_type: str = Field(min_length=1, max_length=80)
    input_payload: dict[str, Any] = Field(default_factory=dict)
    expected_payload: dict[str, Any] = Field(default_factory=dict)


class EvaluationCaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int | None
    book_id: int | None
    case_name: str
    case_type: str
    status: str
    input_payload: dict[str, Any]
    expected_payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class EvaluationRunCreate(BaseModel):
    case_id: int | None = Field(default=None, gt=0)
    workspace_id: int | None = Field(default=None, gt=0)
    book_id: int | None = Field(default=None, gt=0)
    observed_payload: dict[str, Any] = Field(default_factory=dict)


class EvaluationRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    case_id: int | None
    workspace_id: int | None
    book_id: int | None
    status: str
    metrics: dict[str, Any]
    summary: str
    created_at: datetime
    updated_at: datetime

