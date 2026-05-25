from __future__ import annotations

import pytest

from storyforge_workflow.runtime.provider_adapter import (
    MockProviderAdapter,
    ProviderParityCase,
    ProviderParityHarness,
    ProviderRequest,
)


def test_provider_parity_harness_accepts_matching_mock_chain() -> None:
    """parity harness 应接受候选 provider 与 Mock Provider 的一致响应。"""

    request = ProviderRequest(
        capability="llm",
        prompt="固定验收输入。",
        model_alias="draft-writer",
        metadata={"request_id": "parity-req"},
    )
    reference = MockProviderAdapter(
        provider_name="mock-provider",
        model_name="mock-writer",
        response_factory=lambda provider_request: f"一致输出：{provider_request.prompt}",
    )
    candidate = MockProviderAdapter(
        provider_name="mock-provider",
        model_name="mock-writer",
        response_factory=lambda provider_request: f"一致输出：{provider_request.prompt}",
    )
    harness = ProviderParityHarness(reference_adapter=reference, candidate_adapter=candidate)

    result = harness.run_case(ProviderParityCase(name="基础 llm 请求", request=request))

    assert result.passed is True
    assert result.differences == ()
    assert result.reference.output_text == "一致输出：固定验收输入。"
    assert result.candidate.output_text == "一致输出：固定验收输入。"


def test_provider_parity_harness_reports_compared_field_differences() -> None:
    """parity harness 应输出精确差异，便于定位 mock 与真实 adapter 偏差。"""

    request = ProviderRequest(capability="llm", prompt="偏差输入。", model_alias=None, metadata={})
    reference = MockProviderAdapter(
        provider_name="mock-provider",
        model_name="mock-writer",
        response_factory=lambda provider_request: "参考输出。",
    )
    candidate = MockProviderAdapter(
        provider_name="mock-provider",
        model_name="mock-writer",
        response_factory=lambda provider_request: "候选输出。",
    )
    harness = ProviderParityHarness(reference_adapter=reference, candidate_adapter=candidate)
    case = ProviderParityCase(name="输出偏差", request=request)

    result = harness.run_case(case)

    assert result.passed is False
    assert result.differences == ("output_text: 参考输出。 != 候选输出。",)
    with pytest.raises(AssertionError, match="provider parity 失败：输出偏差"):
        harness.assert_case(case)


def test_provider_parity_harness_can_compare_usage_when_required() -> None:
    """验收链路可按需扩大比较字段，例如 token_usage。"""

    request = ProviderRequest(capability="llm", prompt="统计输入。", model_alias=None, metadata={})
    reference = MockProviderAdapter(provider_name="mock-provider", model_name="mock-writer", token_usage=21)
    candidate = MockProviderAdapter(provider_name="mock-provider", model_name="mock-writer", token_usage=34)
    harness = ProviderParityHarness(
        reference_adapter=reference,
        candidate_adapter=candidate,
        compared_fields=("provider_name", "model_name", "token_usage"),
    )

    result = harness.run_case(ProviderParityCase(name="usage 比较", request=request))

    assert result.passed is False
    assert result.differences == ("token_usage: 21 != 34",)
