from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from time import perf_counter
from typing import Protocol

from storyforge_workflow.provider_client import generate_text, provider_config


@dataclass(frozen=True)
class ProviderRequest:
    """workflow runtime 传给 provider 的统一请求快照。"""

    capability: str
    prompt: str
    model_alias: str | None
    metadata: dict[str, object]

    def __post_init__(self) -> None:
        object.__setattr__(self, "metadata", dict(self.metadata))


@dataclass(frozen=True)
class ProviderResponse:
    """provider 返回给 workflow runtime 的统一响应快照。"""

    provider_name: str
    model_name: str
    request_id: str | None
    output_text: str
    latency_ms: int
    token_usage: int
    finish_reason: str | None

    def __post_init__(self) -> None:
        if self.latency_ms < 0:
            raise ValueError("provider latency_ms 不能为负数。")
        if self.token_usage < 0:
            raise ValueError("provider token_usage 不能为负数。")


class ProviderAdapter(Protocol):
    """统一 provider 调用边界，真实实现和 Mock 实现共享此协议。"""

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        """根据统一请求生成统一响应。"""


class ProviderClientAdapter:
    """把现有 provider client 包装为 workflow runtime adapter。"""

    def __init__(
        self,
        *,
        generate_text_fn: Callable[[str], str] = generate_text,
        config_loader: Callable[[], dict[str, str]] = provider_config,
        timer: Callable[[], float] = perf_counter,
    ) -> None:
        self._generate_text = generate_text_fn
        self._config_loader = config_loader
        self._timer = timer

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        """调用真实 provider client，并把结果归一化为 ProviderResponse。"""

        config = self._config_loader()
        started_at = self._timer()
        output_text = self._generate_text(request.prompt)
        latency_ms = int((self._timer() - started_at) * 1000)
        return ProviderResponse(
            provider_name=config["provider_name"],
            model_name=config["model"],
            request_id=_request_id(request.metadata),
            output_text=output_text,
            latency_ms=max(0, latency_ms),
            token_usage=_estimate_token_usage(request.prompt, output_text),
            finish_reason="stop",
        )


class MockProviderAdapter:
    """确定性 Mock Provider，用于本地验收和 parity harness。"""

    def __init__(
        self,
        *,
        provider_name: str = "mock-provider",
        model_name: str = "mock-model",
        latency_ms: int = 0,
        token_usage: int = 1,
        finish_reason: str | None = "stop",
        response_factory: Callable[[ProviderRequest], str] | None = None,
    ) -> None:
        if latency_ms < 0:
            raise ValueError("Mock Provider latency_ms 不能为负数。")
        if token_usage < 0:
            raise ValueError("Mock Provider token_usage 不能为负数。")
        self.provider_name = provider_name
        self.model_name = model_name
        self.latency_ms = latency_ms
        self.token_usage = token_usage
        self.finish_reason = finish_reason
        self._response_factory = response_factory or _default_mock_response

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        output_text = self._response_factory(request)
        return ProviderResponse(
            provider_name=self.provider_name,
            model_name=self.model_name,
            request_id=_request_id(request.metadata),
            output_text=output_text,
            latency_ms=self.latency_ms,
            token_usage=self.token_usage,
            finish_reason=self.finish_reason,
        )


@dataclass(frozen=True)
class ProviderParityCase:
    """单条 provider parity 验收用例。"""

    name: str
    request: ProviderRequest


@dataclass(frozen=True)
class ProviderParityResult:
    """记录候选 provider 与参考 provider 的字段级比较结果。"""

    case_name: str
    passed: bool
    differences: tuple[str, ...]
    reference: ProviderResponse
    candidate: ProviderResponse


class ProviderParityHarness:
    """用同一请求比较参考 provider 与候选 provider 的验收工具。"""

    _DEFAULT_COMPARED_FIELDS = ("provider_name", "model_name", "output_text", "finish_reason")

    def __init__(
        self,
        *,
        reference_adapter: ProviderAdapter,
        candidate_adapter: ProviderAdapter,
        compared_fields: tuple[str, ...] | None = None,
    ) -> None:
        fields = compared_fields or self._DEFAULT_COMPARED_FIELDS
        if not fields:
            raise ValueError("provider parity 至少需要比较一个字段。")
        self.reference_adapter = reference_adapter
        self.candidate_adapter = candidate_adapter
        self.compared_fields = fields

    def run_case(self, case: ProviderParityCase) -> ProviderParityResult:
        reference = self.reference_adapter.generate(case.request)
        candidate = self.candidate_adapter.generate(case.request)
        differences = tuple(_field_difference(field, reference, candidate) for field in self.compared_fields)
        differences = tuple(difference for difference in differences if difference is not None)
        return ProviderParityResult(
            case_name=case.name,
            passed=not differences,
            differences=differences,
            reference=reference,
            candidate=candidate,
        )

    def assert_case(self, case: ProviderParityCase) -> ProviderParityResult:
        result = self.run_case(case)
        if not result.passed:
            details = "；".join(result.differences)
            raise AssertionError(f"provider parity 失败：{case.name}：{details}")
        return result


def _default_mock_response(request: ProviderRequest) -> str:
    return f"Mock Provider 响应：{request.prompt}"


def _request_id(metadata: dict[str, object]) -> str | None:
    value = metadata.get("request_id")
    return value if isinstance(value, str) and value else None


def _estimate_token_usage(prompt: str, output_text: str) -> int:
    return max(1, (len(prompt) + len(output_text)) // 4)


def _field_difference(field: str, reference: ProviderResponse, candidate: ProviderResponse) -> str | None:
    if not hasattr(reference, field) or not hasattr(candidate, field):
        raise ValueError(f"未知 provider parity 字段：{field}")
    reference_value = getattr(reference, field)
    candidate_value = getattr(candidate, field)
    if reference_value == candidate_value:
        return None
    return f"{field}: {reference_value} != {candidate_value}"
