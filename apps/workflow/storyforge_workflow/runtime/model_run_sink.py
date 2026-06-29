from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ModelRunPayload:
    """投递给外部 ModelRun 持久化 adapter 的最小字段集合。"""

    thread_id: str
    job_run_id: str
    provider_name: str
    model_name: str
    capability: str
    latency_ms: int
    token_usage: int
    input_summary: str
    output_summary: str
    status: str
    error_message: str | None
    extras: dict[str, object] | None = None

    def to_api_payload(self, *, api_job_run_id: int) -> dict[str, object]:
        """转换为 API ModelRunCreate 兼容字段，显式使用 API 真表的 int 任务 ID。"""

        validated_job_run_id = validate_api_job_run_id(api_job_run_id)
        payload_metadata: dict[str, object] = {
            "thread_id": self.thread_id,
            "runtime_job_run_id": self.job_run_id,
        }
        if self.extras:
            payload_metadata.update(self.extras)
        api_payload: dict[str, object] = {
            "job_run_id": validated_job_run_id,
            "provider_name": self.provider_name,
            "model_name": self.model_name,
            "capability": self.capability,
            "status": self.status,
            "latency_ms": self.latency_ms,
            "token_usage": self.token_usage,
            "input_summary": self.input_summary,
            "output_summary": self.output_summary,
            "error_message": self.error_message,
            "payload": payload_metadata,
        }
        promote_observability_fields(api_payload, payload_metadata)
        return api_payload


class ModelRunSink(Protocol):
    """workflow 到 API ModelRun 真表 adapter 的可替换边界。"""

    def record(self, payload: ModelRunPayload) -> int | None:
        """接收模型运行摘要；返回值为已持久化 API ModelRun ID。"""


class ApiModelRunAdapter:
    """把 workflow payload 交给 API 真表写入函数的最小 adapter。"""

    def __init__(self, *, api_job_run_id: int, record_api_model_run: Callable[[dict[str, object]], int]) -> None:
        self.api_job_run_id = validate_api_job_run_id(api_job_run_id)
        self.record_api_model_run = record_api_model_run

    def record(self, payload: ModelRunPayload) -> int:
        api_payload = payload.to_api_payload(api_job_run_id=self.api_job_run_id)
        return self.record_api_model_run(api_payload)


def validate_api_job_run_id(api_job_run_id: object) -> int:
    """确认传入的是 API JobRun 真表的正整数主键，而不是 workflow 字符串 ID。"""

    if type(api_job_run_id) is not int or api_job_run_id <= 0:
        raise ValueError("API ModelRun 的 job_run_id 必须是已持久化 JobRun 的正整数 ID。")
    return api_job_run_id


def promote_observability_fields(api_payload: dict[str, object], metadata: dict[str, object]) -> None:
    input_tokens = optional_nonnegative_int(metadata.get("prompt_tokens"))
    if input_tokens is None:
        input_tokens = optional_nonnegative_int(metadata.get("input_tokens"))
    output_tokens = optional_nonnegative_int(metadata.get("completion_tokens"))
    if output_tokens is None:
        output_tokens = optional_nonnegative_int(metadata.get("output_tokens"))
    field_map = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_estimate": optional_nonnegative_float(metadata.get("cost_estimate")),
        "finish_reason": optional_text(metadata.get("finish_reason")),
        "error_kind": optional_text(metadata.get("error_kind")),
        "retry_count": optional_nonnegative_int(metadata.get("retry_count")),
        "repair_count": optional_nonnegative_int(metadata.get("repair_count")),
        "prompt_template_version": optional_text(metadata.get("prompt_template_version")),
        "prompt_hash": optional_text(metadata.get("prompt_hash")),
    }
    for key, value in field_map.items():
        if value is not None:
            api_payload[key] = value


def optional_nonnegative_int(value: object) -> int | None:
    if type(value) is int and value >= 0:
        return value
    return None


def optional_nonnegative_float(value: object) -> float | None:
    if isinstance(value, int | float) and not isinstance(value, bool) and value >= 0:
        return float(value)
    return None


def optional_text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
