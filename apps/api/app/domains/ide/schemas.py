from __future__ import annotations

from pydantic import BaseModel, Field, field_serializer

from app.common.redaction import redact_sensitive


class IdeCommandRequest(BaseModel):
    """IDE 命令执行请求，所有写操作通过 args 传入参数。"""

    args: dict[str, object] = Field(default_factory=dict)


class IdeCommandResult(BaseModel):
    """IDE 命令执行结果，供前端统一处理审计与载荷。"""

    command_id: str
    status: str
    audit_event_id: str | None = None
    payload: dict[str, object] = Field(default_factory=dict)

    @field_serializer("payload")
    def serialize_payload(self, payload: dict[str, object]) -> dict[str, object]:
        return redact_sensitive(payload)


class IdeRunEvent(BaseModel):
    """IDE Run Panel 消费的 BookRun 事件。"""

    event: str
    data: dict[str, object] = Field(default_factory=dict)


class IdeCrossChapterInput(BaseModel):
    """跨章一致性检查的单章输入（整章正文,非摘录）。"""

    name: str
    content: str


class IdeCrossChapterRequest(BaseModel):
    """跨章一致性检查请求:至少两章 + 可选关注点。"""

    chapters: list[IdeCrossChapterInput] = Field(min_length=2)
    focus: str | None = None


class IdeCrossChapterFinding(BaseModel):
    """一条跨章硬冲突,带涉及章节与原文证据。"""

    type: str
    severity: str
    chapters: list[str] = Field(default_factory=list)
    finding: str
    evidence: str


class IdeCrossChapterResult(BaseModel):
    """跨章一致性检查响应。"""

    findings: list[IdeCrossChapterFinding] = Field(default_factory=list)
    model: str | None = None
    latency_ms: int | None = None
