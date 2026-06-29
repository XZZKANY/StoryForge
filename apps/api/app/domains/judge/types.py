"""Judge 域 Types 与常量。

数据类、异常、常量集中定义，供其他模块单向引用。
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from app.common.exceptions import InputError


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
    """

    issues: list[DetectedIssue]
    failed: bool


# 确定性文风漂移检测短语
STYLE_DRIFT_PHRASES = ("作者直接解释", "设定说明", "旁白解释", "直接说明设定", "作者在这里解释")
STYLE_FINGERPRINT_DRIFT_PHRASES = (
    *STYLE_DRIFT_PHRASES,
    "这说明",
    "意味着",
    "读者立刻明白",
    "宏大轮盘",
)
STYLE_RESTRAINT_MARKERS = ("克制", "沉默", "低声", "按住", "没有解释", "只把")
STYLE_FINGERPRINT_THRESHOLD = 0.62

# Judge Provider 类型别名（callable signature for LLM provider）
JudgeProvider = Callable[..., Sequence[dict[str, object] | DetectedIssue]]


@dataclass(frozen=True)
class StyleFingerprint:
    """用少量可解释特征描述已批准章节的文风基线。"""

    average_sentence_length: float
    exposition_density: float
    restraint_density: float
    dialogue_ratio: float
    sentence_count: int

    def as_payload(self) -> dict[str, float | int]:
        return {
            "average_sentence_length": self.average_sentence_length,
            "exposition_density": self.exposition_density,
            "restraint_density": self.restraint_density,
            "dialogue_ratio": self.dialogue_ratio,
            "sentence_count": self.sentence_count,
        }
