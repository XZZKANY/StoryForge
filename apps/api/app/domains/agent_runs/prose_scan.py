"""文笔气味静态检查：对单个稿件做确定性坏味道扫描，不下最终结论。

从 workflow `quality/prose_static_check.py` 抢救进 live agent（迁移 ledger tier-1，
见 docs/internal/workflow-capability-migration-ledger.md §2b）。project.consistency 只做
机械计数、project.deep_consistency 是语义 judge（烧 token）；本模块补「丰富文笔气味检测」
这条缺口——陈词套话、说明腔、情绪直述、解释性旁白、对白密度、句长、重复表达、静态节奏，
全为确定性规则，不依赖模型或 key。

产出是 advisory 观察信号：是否采纳由循环 LLM 结合原文判断，修改仍走待确认补丁红线。
路径边界与只读约束复用 fs_tools（同包私有复用，先例见 consistency_scan / deep_consistency）。

`check_prose_static_quality` 保留 workflow 侧的完整签名（含 character_constraints /
continuity_facts / required_facts / scene_beats / ending_hook）——这些吃约束的维度是 gate 的
真实接口，留给后续 slice 接 canon 事实 / 人物禁止表现；slice-1 的工具入口只喂正文，
角色 / 连续性 / beat 维度自然为空（与 deep_consistency、canon 的语义 / 结构线不重叠）。
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from app.domains.agent_runs.fs_tools import (
    FsToolError,
    _read_text,
    _resolve_root,
    _resolve_scoped,
)

_MAX_FILE_BYTES = 512_000
_CONTENT_CHAR_BUDGET = 24_000


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


_CLICHE_PHRASES = (
    "不禁",
    "五味杂陈",
    "心中一震",
    "情不自禁",
    "无法言喻",
    "莫名",
    "深深地",
)
_EMOTION_WORDS = ("愤怒", "害怕", "恐惧", "悲伤", "痛苦", "开心", "绝望", "紧张", "难过")
_TELLING_PATTERNS = (
    re.compile(r"[一-鿿]{1,8}(很|非常|十分|特别|有些|感到|觉得)(愤怒|害怕|恐惧|悲伤|痛苦|开心|绝望|紧张|难过)"),
    re.compile(r"不知道该怎么办"),
)
_EXPLANATION_MARKERS = ("因为", "所以", "这意味着", "事实上", "换句话说", "他知道", "她知道")
_NEGATION_MARKERS = ("从未", "没有", "不会", "再也不", "不再", "并未")
_ACTION_MARKERS = ("走", "推", "拉", "抬", "按", "握", "转", "停", "藏", "递", "看", "问", "说", "答")


def check_prose_static_quality(
    text: str,
    *,
    character_constraints: Sequence[Mapping[str, Any]] | None = None,
    continuity_facts: Sequence[Any] | None = None,
    required_facts: Sequence[str] | None = None,
    scene_beats: Sequence[str] | None = None,
    ending_hook: str = "",
) -> list[StaticProseIssue]:
    """返回可重复的小说坏味道 issue，不依赖模型或外部 NLP。"""

    prose = text.strip() if isinstance(text, str) else ""
    if not prose:
        return [
            StaticProseIssue(
                dimension="正文完整性",
                severity="严重",
                snippet="（空）",
                message="正文为空，无法进入质量评审。",
                suggestion="重新生成本场景正文。",
                revision_strategy="regenerate",
            )
        ]

    issues: list[StaticProseIssue] = []
    issues.extend(_check_cliches(prose))
    issues.extend(_check_telling(prose))
    issues.extend(_check_exposition(prose))
    issues.extend(_check_dialogue_density(prose))
    issues.extend(_check_sentence_length(prose))
    issues.extend(_check_repetition(prose))
    issues.extend(_check_character_consistency(prose, character_constraints or ()))
    issues.extend(_check_continuity(prose, continuity_facts or (), required_facts or ()))
    issues.extend(_check_progression(prose, scene_beats or (), ending_hook))
    return _dedupe(issues)


def _check_cliches(prose: str) -> list[StaticProseIssue]:
    hits = [phrase for phrase in _CLICHE_PHRASES if phrase in prose]
    if not hits:
        return []
    severity = "中" if len(hits) >= 2 else "低"
    return [
        StaticProseIssue(
            dimension="套话",
            severity=severity,
            snippet="、".join(hits),
            message="出现高频陈词套话，削弱画面和人物独特性。",
            suggestion="替换为具体动作、感官细节或角色专属表达。",
            revision_strategy="line_edit",
        )
    ]


def _check_telling(prose: str) -> list[StaticProseIssue]:
    issues: list[StaticProseIssue] = []
    for pattern in _TELLING_PATTERNS:
        match = pattern.search(prose)
        if match:
            issues.append(
                StaticProseIssue(
                    dimension="说明腔",
                    severity="中",
                    snippet=match.group(0),
                    message="直接说明情绪或困境，缺少动作与触觉承载。",
                    suggestion="用身体反应、动作选择或对白压力呈现情绪。",
                    revision_strategy="line_edit",
                )
            )
            break
    emotion_hits = [word for word in _EMOTION_WORDS if word in prose]
    if len(emotion_hits) >= 2:
        issues.append(
            StaticProseIssue(
                dimension="情绪直述",
                severity="中",
                snippet="、".join(emotion_hits[:4]),
                message="抽象情绪词密集出现，读者只能被告知而非看见。",
                suggestion="保留情绪方向，但改成动作、环境反馈和对白潜台词。",
                revision_strategy="line_edit",
            )
        )
    return issues


def _check_exposition(prose: str) -> list[StaticProseIssue]:
    hits = [marker for marker in _EXPLANATION_MARKERS if prose.count(marker) >= 2]
    if not hits:
        return []
    return [
        StaticProseIssue(
            dimension="解释性旁白",
            severity="低",
            snippet="、".join(hits),
            message="解释性连接词偏多，容易形成作者代讲。",
            suggestion="让信息通过冲突行动、对白和场景物件自然暴露。",
            revision_strategy="scene_patch",
        )
    ]


def _check_dialogue_density(prose: str) -> list[StaticProseIssue]:
    length = len(_visible_chars(prose))
    if length < 40:
        return []
    quoted = sum(len(match.group(0)) for match in re.finditer(r"[“\"].+?[”\"]", prose, flags=re.S))
    ratio = quoted / max(length, 1)
    if ratio < 0.08 and length >= 80:
        return [
            StaticProseIssue(
                dimension="对白密度",
                severity="低",
                snippet=prose[:32],
                message="对白不足，信息可能被旁白单向交代。",
                suggestion="加入有明确目的的对白，让角色在压力中交换信息。",
                revision_strategy="scene_patch",
            )
        ]
    if ratio > 0.82:
        return [
            StaticProseIssue(
                dimension="对白密度",
                severity="低",
                snippet=prose[:32],
                message="叙述不足，场景缺少动作、环境和节奏落点。",
                suggestion="在对白间补入动作反应和感官锚点。",
                revision_strategy="scene_patch",
            )
        ]
    return []


def _check_sentence_length(prose: str) -> list[StaticProseIssue]:
    sentences = [item for item in re.split(r"[。！？!?\n]+", prose) if item.strip()]
    if not sentences:
        return []
    long_sentence = next((item for item in sentences if len(item) > 90), "")
    if long_sentence:
        return [
            StaticProseIssue(
                dimension="句长",
                severity="低",
                snippet=long_sentence[:36],
                message="单句过长，动作和信息层次容易糊在一起。",
                suggestion="按动作、感知和转折拆分句子。",
                revision_strategy="line_edit",
            )
        ]
    if len(sentences) >= 6 and sum(1 for item in sentences if len(item) <= 8) / len(sentences) > 0.75:
        return [
            StaticProseIssue(
                dimension="句长",
                severity="低",
                snippet="。".join(sentences[:4]),
                message="短句连续堆叠，节奏机械。",
                suggestion="合并部分静态短句，并加入动作推进。",
                revision_strategy="scene_patch",
            )
        ]
    return []


def _check_repetition(prose: str) -> list[StaticProseIssue]:
    chunks = [prose[index : index + 4] for index in range(max(len(prose) - 3, 0))]
    repeated = [chunk for chunk, count in Counter(chunks).items() if count >= 3 and len(set(chunk)) > 1]
    if not repeated:
        return []
    return [
        StaticProseIssue(
            dimension="重复表达",
            severity="低",
            snippet=repeated[0],
            message="短窗口表达重复，可能显得机械或注水。",
            suggestion="保留必要信息，改写重复句式和词组。",
            revision_strategy="line_edit",
        )
    ]


def _check_character_consistency(
    prose: str, character_constraints: Sequence[Mapping[str, Any]]
) -> list[StaticProseIssue]:
    issues: list[StaticProseIssue] = []
    for entry in character_constraints:
        forbidden = entry.get("forbidden_traits") if isinstance(entry, Mapping) else None
        if not isinstance(forbidden, Sequence) or isinstance(forbidden, (str, bytes)):
            continue
        hits = [str(item).strip() for item in forbidden if str(item).strip() and str(item).strip() in prose]
        if hits:
            issues.append(
                StaticProseIssue(
                    dimension="角色一致性",
                    severity="严重",
                    snippet="、".join(hits),
                    message="正文命中角色禁止表现，存在 OOC 风险。",
                    suggestion="回到角色约束，重写违背人设的动作和对白。",
                    revision_strategy="regenerate",
                )
            )
    return issues


def _check_continuity(
    prose: str, continuity_facts: Sequence[Any], required_facts: Sequence[str]
) -> list[StaticProseIssue]:
    facts = [_fact_text(item) for item in (*continuity_facts, *required_facts)]
    issues: list[StaticProseIssue] = []
    for fact in facts:
        if not fact:
            continue
        key_terms = _key_terms(fact)
        negated = any(marker in prose for marker in _NEGATION_MARKERS) and any(term in prose for term in key_terms)
        missing_required = fact in required_facts and not any(term in prose for term in key_terms[:2])
        if negated or missing_required:
            issues.append(
                StaticProseIssue(
                    dimension="连续性",
                    severity="严重" if negated else "高",
                    snippet=fact,
                    message="正文与连续性事实或必含事实不一致。",
                    suggestion="保留既定事实，删除矛盾表述后重写相关段落。",
                    revision_strategy="regenerate" if negated else "scene_patch",
                )
            )
            break
    return issues


def _check_progression(prose: str, scene_beats: Sequence[str], ending_hook: str) -> list[StaticProseIssue]:
    issues: list[StaticProseIssue] = []
    if scene_beats:
        matched = sum(1 for beat in scene_beats if any(term in prose for term in _key_terms(str(beat))))
        if matched == 0:
            issues.append(
                StaticProseIssue(
                    dimension="推进",
                    severity="中",
                    snippet=" / ".join(str(beat) for beat in scene_beats[:3]),
                    message="正文未体现计划中的动作 beat，场景可能停滞。",
                    suggestion="补入至少一个会改变局势的动作或转折。",
                    revision_strategy="scene_patch",
                )
            )
    action_count = sum(prose.count(marker) for marker in _ACTION_MARKERS)
    if len(prose) >= 45 and action_count <= 2:
        issues.append(
            StaticProseIssue(
                dimension="节奏",
                severity="中",
                snippet=prose[:36],
                message="静态描述偏多，缺少行动 beat。",
                suggestion="加入目标、阻碍和段末变化，推动下一段。",
                revision_strategy="scene_patch",
            )
        )
    if ending_hook and not any(term in prose[-40:] for term in _key_terms(ending_hook)):
        issues.append(
            StaticProseIssue(
                dimension="节奏",
                severity="低",
                snippet=ending_hook,
                message="结尾未兑现计划钩子，段落收束力不足。",
                suggestion="把钩子放入末段，并让它改变下一步行动。",
                revision_strategy="scene_patch",
            )
        )
    return issues


def _visible_chars(prose: str) -> str:
    return re.sub(r"\s+", "", prose)


def _fact_text(item: Any) -> str:
    if isinstance(item, Mapping):
        return str(item.get("statement") or "").strip()
    return str(item).strip()


def _key_terms(text: str) -> list[str]:
    terms = [part for part in re.split(r"[，。、“”\s/]+", text) if len(part) >= 2]
    if terms:
        return terms
    return [text] if text else []


def _dedupe(issues: list[StaticProseIssue]) -> list[StaticProseIssue]:
    seen: set[tuple[str, str, str]] = set()
    result: list[StaticProseIssue] = []
    for issue in issues:
        key = (issue.dimension, issue.severity, issue.snippet)
        if key not in seen:
            seen.add(key)
            result.append(issue)
    return result


def prose_static_scan(project_root: str, path: str) -> dict[str, Any]:
    """对项目内单个稿件跑确定性文笔气味扫描，返回 advisory issue 信号。

    path-scoped 只读：越界（../ / 绝对路径 / 符号链接逃逸）由 fs_tools 拒绝；空文件显式报错，
    不伪造「无问题」。slice-1 只喂正文，角色 / 连续性约束维度留给后续 slice。
    """

    root = _resolve_root(project_root)
    target = _resolve_scoped(root, path)
    if not target.is_file():
        raise FsToolError(f"不是文件：{path}")
    target_relative = target.relative_to(root).as_posix()

    raw_content = _read_text(target, max_bytes=_MAX_FILE_BYTES)
    if not raw_content.strip():
        raise FsToolError(f"文件没有可检查的内容：{path}")
    content = raw_content[:_CONTENT_CHAR_BUDGET]
    content_truncated = len(raw_content) > _CONTENT_CHAR_BUDGET

    issues = check_prose_static_quality(content)
    dimension_counts = Counter(issue.dimension for issue in issues)
    severity_counts = Counter(issue.severity for issue in issues)

    return {
        "path": target_relative,
        "content_chars": len(content),
        "content_truncated": content_truncated,
        "issue_count": len(issues),
        "issues": [issue.as_report_item() for issue in issues],
        "dimension_counts": dict(dimension_counts),
        "severity_counts": dict(severity_counts),
        "note": (
            "文笔气味是确定性观察信号（无 LLM）：是否采纳由你结合上下文判断，"
            "别照单全收；修改仍需走待确认补丁流程。"
        ),
    }
