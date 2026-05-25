from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ModelRunCreate(BaseModel):
    workspace_id: int | None = Field(default=None, gt=0)
    book_id: int | None = Field(default=None, gt=0)
    scene_id: int | None = Field(default=None, gt=0)
    job_run_id: int | None = Field(default=None, gt=0)
    prompt_pack_id: int | None = Field(default=None, gt=0)
    provider_name: str = Field(min_length=1, max_length=80)
    model_name: str = Field(min_length=1, max_length=120)
    capability: str = Field(min_length=1, max_length=80)
    status: str = Field(default="completed", min_length=1, max_length=50)
    latency_ms: int = Field(default=0, ge=0)
    token_usage: int = Field(default=0, ge=0)
    input_summary: str = Field(min_length=1)
    output_summary: str | None = None
    error_message: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class ModelRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    workspace_id: int | None
    book_id: int | None
    scene_id: int | None
    job_run_id: int | None
    prompt_pack_id: int | None
    provider_name: str
    model_name: str
    capability: str
    status: str
    latency_ms: int
    token_usage: int
    input_summary: str
    output_summary: str | None
    error_message: str | None
    payload: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class RunsModelRunSummary(BaseModel):
    id: int
    provider_name: str
    model_name: str
    capability: str
    status: str
    latency_ms: int
    token_usage: int
    error_message: str | None


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


class RunsProviderSummary(BaseModel):
    """ProviderAdapter 或 ModelRun 派生的供应商调用摘要。"""

    provider_name: str
    model_name: str
    capability: str
    status: str
    latency_ms: int
    token_usage: int
    error_message: str | None


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


class RunsJobRunRetryRead(BaseModel):
    """Runs 失败重试执行结果，只创建恢复任务并返回入口状态。"""

    can_retry: bool
    retry_job_run_id: int | None
    source_job_run_id: int
    recovery_node: str | None
    checkpoint: dict[str, Any] | None
    retry_status: str
    unavailable_reason: str | None

