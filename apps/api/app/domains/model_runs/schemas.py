from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from app.common.redaction import redact_sensitive, redact_sensitive_text


class ModelRunCreate(BaseModel):
    workspace_id: int | None = Field(default=None, gt=0)
    book_id: int | None = Field(default=None, gt=0)
    book_run_id: int | None = Field(default=None, gt=0)
    chapter_id: int | None = Field(default=None, gt=0)
    scene_id: int | None = Field(default=None, gt=0)
    job_run_id: int | None = Field(default=None, gt=0)
    prompt_pack_id: int | None = Field(default=None, gt=0)
    provider_name: str = Field(min_length=1, max_length=80)
    model_name: str = Field(min_length=1, max_length=120)
    capability: str = Field(min_length=1, max_length=80)
    status: str = Field(default="completed", min_length=1, max_length=50)
    latency_ms: int = Field(default=0, ge=0)
    token_usage: int = Field(default=0, ge=0)
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    cost_estimate: float = Field(default=0.0, ge=0)
    finish_reason: str | None = Field(default=None, max_length=80)
    error_kind: str | None = Field(default=None, max_length=80)
    retry_count: int = Field(default=0, ge=0)
    repair_count: int = Field(default=0, ge=0)
    prompt_template_version: str | None = Field(default=None, max_length=120)
    prompt_hash: str | None = Field(default=None, max_length=128)
    input_summary: str = Field(min_length=1, max_length=50000)
    output_summary: str | None = Field(default=None, max_length=50000)
    error_message: str | None = Field(default=None, max_length=10000)
    payload: dict[str, Any] = Field(default_factory=dict)


class ModelRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int | None
    book_id: int | None
    book_run_id: int | None
    chapter_id: int | None
    scene_id: int | None
    job_run_id: int | None
    prompt_pack_id: int | None
    provider_name: str
    model_name: str
    capability: str
    status: str
    latency_ms: int
    token_usage: int
    input_tokens: int
    output_tokens: int
    cost_estimate: float
    finish_reason: str | None
    error_kind: str | None
    retry_count: int
    repair_count: int
    prompt_template_version: str | None
    prompt_hash: str | None
    input_summary: str
    output_summary: str | None
    error_message: str | None
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    @field_serializer("input_summary", return_type=str)
    def serialize_input_summary(self, value: str) -> str:
        return redact_sensitive_text(value)

    @field_serializer("output_summary", "error_message", return_type=str | None)
    def serialize_sensitive_text(self, value: str | None) -> str | None:
        return redact_sensitive_text(value) if isinstance(value, str) else value

    @field_serializer("payload", return_type=dict[str, Any])
    def serialize_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        return redact_sensitive(payload)


class ModelRunListPage(BaseModel):
    """模型运行日志的游标分页响应。"""

    items: list[ModelRunRead]
    next_cursor: str | None = None
    has_more: bool = False


class RunsModelRunSummary(BaseModel):
    id: int
    provider_name: str
    model_name: str
    capability: str
    status: str
    latency_ms: int
    token_usage: int
    input_tokens: int
    output_tokens: int
    cost_estimate: float
    finish_reason: str | None
    error_kind: str | None
    retry_count: int
    repair_count: int
    prompt_template_version: str | None
    prompt_hash: str | None
    error_message: str | None

    @field_serializer("error_message")
    def serialize_error_message(self, value: str | None) -> str | None:
        return redact_sensitive_text(value) if isinstance(value, str) else value


class RunsWorkflowSessionSummary(BaseModel):
    """从 JobRun 运行时同步字段派生的 WorkflowSession 摘要。"""

    session_id: str | None
    thread_id: str | None
    job_run_id: str
    status: str
    current_node: str
    approval_status: str | None
    last_heartbeat_ms: int | None
    prompt_count: int


class RunsWorkflowLifecycleSummary(BaseModel):
    """运行生命周期最新摘要，用于页面展示恢复边界。"""

    status: str
    current_node: str
    message: str
    failure_kind: str | None
    recoverable: bool | None

    @field_serializer("message")
    def serialize_message(self, value: str) -> str:
        return redact_sensitive_text(value)


class RunsProviderSummary(BaseModel):
    """ProviderAdapter 或 ModelRun 派生的供应商调用摘要。"""

    provider_name: str
    model_name: str
    capability: str
    status: str
    latency_ms: int
    token_usage: int
    error_message: str | None

    @field_serializer("error_message")
    def serialize_error_message(self, value: str | None) -> str | None:
        return redact_sensitive_text(value) if isinstance(value, str) else value


class RunsModelUsageSummary(BaseModel):
    """ModelRun 真表派生的轻量用量聚合。"""

    model_run_count: int
    failed_model_run_count: int
    total_token_usage: int
    max_latency_ms: int


class RunsRuntimeToolSummary(BaseModel):
    """本次运行命中的运行时工具能力摘要，不包含大 schema payload。"""

    name: str
    domain: str
    required_capabilities: list[str]
    evidence_fields: list[str]
    workflow_nodes: list[str]


class RunsRuntimeDiagnosticsRead(BaseModel):
    """Runs 页面统一读取的运行时诊断摘要。"""

    workflow_session: RunsWorkflowSessionSummary
    workflow_lifecycle: RunsWorkflowLifecycleSummary
    provider: RunsProviderSummary | None
    model_usage: RunsModelUsageSummary
    runtime_tools: list[RunsRuntimeToolSummary]


class RunsJobRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_type: str
    status: str
    progress: dict[str, Any]
    checkpoint: dict[str, Any] | None
    model_runs: list[RunsModelRunSummary]
    runtime_diagnostics: RunsRuntimeDiagnosticsRead
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    @field_serializer("error_message")
    def serialize_error_message(self, value: str | None) -> str | None:
        return redact_sensitive_text(value) if isinstance(value, str) else value


class RunsJobRunRetryRead(BaseModel):
    """Runs 失败重试执行结果，只创建恢复任务并返回入口状态。"""

    can_retry: bool
    retry_job_run_id: int | None
    source_job_run_id: int
    recovery_node: str | None
    checkpoint: dict[str, Any] | None
    retry_status: str
    unavailable_reason: str | None
