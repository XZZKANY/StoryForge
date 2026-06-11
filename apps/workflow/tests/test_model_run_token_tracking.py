from __future__ import annotations

from storyforge_workflow.runtime.checkpoints import ApiModelRunAdapter, ModelRunPayload


def test_model_run_payload_to_api_payload_merges_extras_into_payload_dict() -> None:
    """Token 用量追踪：prompt/completion/total/cost_estimate 字段必须落入 ModelRun.payload。"""

    payload = ModelRunPayload(
        thread_id="thread-token",
        job_run_id="runtime-token-job",
        provider_name="openai",
        model_name="gpt-4o-mini",
        capability="llm",
        latency_ms=120,
        token_usage=210,
        input_summary="输入",
        output_summary="输出",
        status="completed",
        error_message=None,
        extras={
            "prompt_tokens": 90,
            "completion_tokens": 120,
            "total_tokens": 210,
            "cost_estimate": 0.000123,
            "fallback": {
                "primary_provider_error": "主超时",
                "primary_provider_status_code": 504,
            },
        },
    )

    api_payload = payload.to_api_payload(api_job_run_id=88)

    assert api_payload["payload"]["runtime_job_run_id"] == "runtime-token-job"
    assert api_payload["payload"]["thread_id"] == "thread-token"
    assert api_payload["payload"]["prompt_tokens"] == 90
    assert api_payload["payload"]["completion_tokens"] == 120
    assert api_payload["payload"]["total_tokens"] == 210
    assert api_payload["payload"]["cost_estimate"] == 0.000123
    assert api_payload["payload"]["fallback"]["primary_provider_status_code"] == 504
    assert api_payload["input_tokens"] == 90
    assert api_payload["output_tokens"] == 120
    assert api_payload["cost_estimate"] == 0.000123


def test_model_run_payload_to_api_payload_promotes_observability_extras() -> None:
    """Workflow extras 中的可观测字段应同步提升到 API ModelRun 顶层字段。"""

    payload = ModelRunPayload(
        thread_id="thread-observe",
        job_run_id="runtime-observe-job",
        provider_name="openai",
        model_name="gpt-4o-mini",
        capability="llm",
        latency_ms=120,
        token_usage=210,
        input_summary="输入",
        output_summary="输出",
        status="failed",
        error_message="provider 返回 HTTP 429，触发限流。",
        extras={
            "prompt_tokens": 90,
            "completion_tokens": 120,
            "total_tokens": 210,
            "cost_estimate": 0.000123,
            "finish_reason": "length",
            "error_kind": "rate_limit",
            "retry_count": 2,
            "repair_count": 1,
            "prompt_template_version": "draft-v3",
            "prompt_hash": "sha256:abc123",
            "retry_after_seconds": 15,
        },
    )

    api_payload = payload.to_api_payload(api_job_run_id=88)

    assert api_payload["input_tokens"] == 90
    assert api_payload["output_tokens"] == 120
    assert api_payload["cost_estimate"] == 0.000123
    assert api_payload["finish_reason"] == "length"
    assert api_payload["error_kind"] == "rate_limit"
    assert api_payload["retry_count"] == 2
    assert api_payload["repair_count"] == 1
    assert api_payload["prompt_template_version"] == "draft-v3"
    assert api_payload["prompt_hash"] == "sha256:abc123"
    assert api_payload["payload"]["retry_after_seconds"] == 15


def test_model_run_payload_to_api_payload_without_extras_keeps_legacy_shape() -> None:
    """未提供 extras 时 payload 必须保留 thread_id + runtime_job_run_id 两项最小字段。"""

    payload = ModelRunPayload(
        thread_id="thread-legacy",
        job_run_id="runtime-legacy-job",
        provider_name="mock-provider",
        model_name="storyforge-writer",
        capability="llm",
        latency_ms=5,
        token_usage=6,
        input_summary="x",
        output_summary="y",
        status="completed",
        error_message=None,
    )

    api_payload = payload.to_api_payload(api_job_run_id=99)

    assert api_payload["payload"] == {
        "thread_id": "thread-legacy",
        "runtime_job_run_id": "runtime-legacy-job",
    }


def test_api_model_run_adapter_forwards_extras() -> None:
    captured: dict[str, object] = {}

    def record_api_model_run(api_payload: dict[str, object]) -> int:
        captured.update(api_payload)
        return 4242

    payload = ModelRunPayload(
        thread_id="t-extras",
        job_run_id="runtime-extras",
        provider_name="openai",
        model_name="gpt-4o-mini",
        capability="llm",
        latency_ms=50,
        token_usage=80,
        input_summary="prompt",
        output_summary="completion",
        status="completed",
        error_message=None,
        extras={"prompt_tokens": 30, "completion_tokens": 50, "total_tokens": 80, "cost_estimate": 0.0},
    )

    adapter = ApiModelRunAdapter(api_job_run_id=11, record_api_model_run=record_api_model_run)
    assert adapter.record(payload) == 4242
    assert captured["payload"]["prompt_tokens"] == 30
    assert captured["payload"]["completion_tokens"] == 50
    assert captured["payload"]["total_tokens"] == 80
    assert captured["payload"]["cost_estimate"] == 0.0
