"""Judge 域 Types 与常量。

数据类、异常、常量集中定义，供其他模块单向引用。
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from app.common.exceptions import InputError
from app.common.style_fingerprint import (  # noqa: F401  别名再导出：既有 judge 调用点零改动
    STYLE_DRIFT_PHRASES,
    STYLE_FINGERPRINT_DRIFT_PHRASES,
    STYLE_RESTRAINT_MARKERS,
    StyleFingerprint,
)


class JudgeInputError(InputError):
    """评审请求无法定位场景或上下文包时抛出。"""


# 语义评审调用本身失败时落的标记类别：区别于"评审通过没发现问题"，让审计层看见降级而非误判为干净。
JUDGE_SYSTEM_FAILURE_CATEGORY = "judge_system_failure"


@dataclass(frozen=True)
class DetectedIssue:
    """服务内部的确定性命中结果，写库前先保持字段完整。"""

    category: str
    severity: str
    span_start: int
    span_end: int
    summary: str
    recommended_repair_mode: str
    expected_text: str
    replacement_text: str
    matched_text: str
    metadata: dict[str, object] | None = None


@dataclass(frozen=True)
class SemanticJudgeOutcome:
    """语义评审结果，把"没发现问题"与"调用失败"区分开。

    failed=True 表示远程模型调用本身出错（网络/超时/响应不可解析），
    此时 issues 为空但绝不能被当成"干净通过"，调用方需据此降级并留痕。
    configured=False 表示未配置 API key、评审未启用（issues 为空且 failed=False）——
    需要区分"干净通过"与"没跑"的调用方看这个标志，不要自己再探一遍 key。
    """

    issues: list[DetectedIssue]
    failed: bool
    configured: bool = True


# 确定性文风漂移检测短语与 StyleFingerprint 已下沉 app/common/style_fingerprint.py
# （桌面产字路径要前馈同一组特征，两处各写一份就会检查器与生成器互不相认）。
STYLE_FINGERPRINT_THRESHOLD = 0.62
FORBIDDEN_DRAFT_TERMS = (
    "Phase",
    "冒烟",
    "真实 LLM",
    "测试",
    "workflow",
    "pipeline",
    "审计链",
    "工具调用",
    "模型",
    "生成器",
    "系统提示",
)

# Judge Provider 类型别名（callable signature for LLM provider）
JudgeProvider = Callable[..., Sequence[dict[str, object] | DetectedIssue]]
