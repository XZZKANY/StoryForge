"""中文网文段落套路规则：确定性计数，只产出 advisory 文笔信号。"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class StaticProseIssue:
    """静态质量问题，字段与 NovelLoop 修订报告保持可序列化。"""

    dimension: str
    severity: str
    snippet: str
    message: str
    suggestion: str
    revision_strategy: str = "line_edit"

    def as_report_item(self) -> dict[str, str]:
        return {
            "dimension": self.dimension,
            "severity": self.severity,
            "snippet": self.snippet,
            "message": self.message,
            "suggestion": self.suggestion,
            "revision_strategy": self.revision_strategy,
        }


# 规则表仅按本任务的中文网文场景自拟，不接入外部词库或语料。
_MECHANICAL_TRANSITION_STARTERS = (
    "与此同时",
    "另一边",
    "时间来到",
    "话分两头",
    "镜头一转",
    "画面回到",
    "故事回到",
    "视线转向",
    "同一时刻",
    "再看此处",
)
_MECHANICAL_TRANSITION_MIN_HITS = 3
_MECHANICAL_TRANSITION_DENSITY = 0.25

_FORMULAIC_QUESTION_PATTERNS = (
    re.compile(r"(?:难道|莫非|究竟|到底|谁能|怎么会)[^。！？!?\n]{0,32}[？?][”」]?$"),
    re.compile(r"[^。！？!?\n]{1,32}(?:吗|么|呢)[？?][”」]?$"),
    re.compile(r"[^。！？!?\n]{1,32}[？?](?:不|没错|答案是)[，,:：]?[^。！？!?\n]{0,32}[。！!]?$"),
)
_FORMULAIC_SUSPENSE_MARKERS = (
    "谁也没想到",
    "没人料到",
    "真正的答案尚未揭晓",
)
_FORMULAIC_QUESTION_MIN_HITS = 3
_FORMULAIC_QUESTION_PER_THOUSAND = 2.0

_BINARY_CONTRAST_PATTERNS = (
    re.compile(r"不是[^。！？!?\n]{1,36}而是[^。！？!?\n]{1,36}"),
    re.compile(r"与其说[^。！？!?\n]{1,36}不如说[^。！？!?\n]{1,36}"),
    re.compile(r"表面上[^。！？!?\n]{1,36}(?:实际上|其实)[^。！？!?\n]{1,36}"),
    re.compile(r"看似[^。！？!?\n]{1,36}(?:实则|却是)[^。！？!?\n]{1,36}"),
    re.compile(r"并非[^。！？!?\n]{1,36}(?:反倒|而在于)[^。！？!?\n]{1,36}"),
)
_BINARY_CONTRAST_MIN_HITS = 3

_HOLLOW_SUMMARY_ENDINGS = (
    "一切才刚刚开始",
    "命运的齿轮",
    "命运的齿轮已经转动",
    "命运的齿轮开始转动",
    "真正的考验还在后面",
    "故事远未结束",
    "这不过是序幕",
    "新的篇章即将展开",
)
_HOLLOW_SUMMARY_PATTERNS = (
    re.compile(
        r"(?:这一切|所有这些)(?:都|不过|只是)?[^。！？!?\n]{0,18}"
        r"(?:命运|未来|人生|时代|意义|开始|序幕)[。！？!?]?$"
    ),
    re.compile(
        r"(?:命运|宿命|未来|真相|时代|传奇|意义|答案)[^。！？!?\n]{0,12}"
        r"(?:刚刚开始|仍在继续|尚未揭晓|无法预知|即将展开)[。！？!?]?$"
    ),
)


def _paragraphs(prose: str) -> list[str]:
    normalized = prose.replace("\r\n", "\n").replace("\r", "\n")
    return [paragraph.strip() for paragraph in normalized.split("\n") if paragraph.strip()]


def _is_dialogue_only(paragraph: str) -> bool:
    pairs = (("“", "”"), ("「", "」"), ('"', '"'))
    return any(paragraph.startswith(left) and paragraph.endswith(right) for left, right in pairs)


def _check_mechanical_transition(paragraphs: list[str]) -> list[StaticProseIssue]:
    hits = [
        starter
        for paragraph in paragraphs
        if (starter := next((item for item in _MECHANICAL_TRANSITION_STARTERS if paragraph.startswith(item)), None))
        is not None
    ]
    density = len(hits) / max(len(paragraphs), 1)
    if len(hits) < _MECHANICAL_TRANSITION_MIN_HITS or density <= _MECHANICAL_TRANSITION_DENSITY:
        return []
    return [
        StaticProseIssue(
            dimension="mechanical_transition",
            severity="低",
            snippet="、".join(hits[:4]),
            message=f"段首转场套语命中 {len(hits)} 段，占非空段落 {density:.0%}，转场节奏可能机械。",
            suggestion="删去可由场景内容自行交代的转场词，用人物动作、地点细节或时间变化直接开段。",
            revision_strategy="scene_patch",
        )
    ]


def _formulaic_question_hit(paragraph: str) -> str | None:
    for marker in _FORMULAIC_SUSPENSE_MARKERS:
        if marker in paragraph:
            return marker
    for pattern in _FORMULAIC_QUESTION_PATTERNS:
        match = pattern.search(paragraph)
        if match is not None:
            return match.group(0)[:48]
    return None


def _check_formulaic_question(prose: str, paragraphs: list[str]) -> list[StaticProseIssue]:
    hits = [
        hit
        for paragraph in paragraphs
        if not _is_dialogue_only(paragraph)
        if (hit := _formulaic_question_hit(paragraph)) is not None
    ]
    visible_chars = len(re.sub(r"\s+", "", prose))
    per_thousand = len(hits) * 1000 / max(visible_chars, 1)
    if len(hits) < _FORMULAIC_QUESTION_MIN_HITS or per_thousand <= _FORMULAIC_QUESTION_PER_THOUSAND:
        return []
    return [
        StaticProseIssue(
            dimension="formulaic_question",
            severity="低",
            snippet=" / ".join(hits[:3]),
            message=f"叙述性设问命中 {len(hits)} 段，约每千字 {per_thousand:.1f} 次，悬念表达可能公式化。",
            suggestion="把部分设问改成可见的异常、选择代价或信息缺口，让悬念由事件产生。",
            revision_strategy="line_edit",
        )
    ]


def _check_binary_contrast(paragraphs: list[str]) -> list[StaticProseIssue]:
    hits: list[str] = []
    for paragraph in paragraphs:
        for pattern in _BINARY_CONTRAST_PATTERNS:
            match = pattern.search(paragraph)
            if match is not None:
                hits.append(match.group(0)[:48])
                break
    if len(hits) < _BINARY_CONTRAST_MIN_HITS:
        return []
    return [
        StaticProseIssue(
            dimension="binary_contrast",
            severity="低",
            snippet=" / ".join(hits[:3]),
            message=f"二元对比句式命中 {len(hits)} 段，反复对偶可能让叙述显得预制。",
            suggestion="保留真正改变理解的一处对比，其余改成具体行动、证据或人物判断。",
            revision_strategy="line_edit",
        )
    ]


def _hollow_summary_hit(paragraph: str) -> bool:
    ending = paragraph.rstrip("。！？!?")
    if any(ending.endswith(item) for item in _HOLLOW_SUMMARY_ENDINGS):
        return True
    return any(pattern.search(paragraph) is not None for pattern in _HOLLOW_SUMMARY_PATTERNS)


def _check_hollow_summary(paragraphs: list[str]) -> list[StaticProseIssue]:
    hits = [
        paragraph[-48:]
        for paragraph in paragraphs
        if not _is_dialogue_only(paragraph) and _hollow_summary_hit(paragraph)
    ]
    if not hits:
        return []
    return [
        StaticProseIssue(
            dimension="hollow_summary",
            severity="低",
            snippet=" / ".join(hits[:3]),
            message=f"发现 {len(hits)} 处段尾空泛总结，抽象收束可能替代了实际变化。",
            suggestion="让段尾落在新事实、人物决定或可追踪后果上，少用泛化命运/未来总结。",
            revision_strategy="scene_patch",
        )
    ]


def check_paragraph_patterns(prose: str) -> list[StaticProseIssue]:
    """聚合四类段落级套路信号，每个维度最多返回一个 issue。"""

    paragraphs = _paragraphs(prose)
    issues: list[StaticProseIssue] = []
    issues.extend(_check_mechanical_transition(paragraphs))
    issues.extend(_check_formulaic_question(prose, paragraphs))
    issues.extend(_check_binary_contrast(paragraphs))
    issues.extend(_check_hollow_summary(paragraphs))
    return issues
