from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.common.craft import CLICHE_PHRASES


def _absence_markers(*markers: str) -> tuple[str, ...]:
    """构造「缺席即问题」的探测词表，剔掉与软禁用套话相交的词。

    真 bug（2026-07-28 修）：写侧 `CRAFT_GUIDELINES` 让作者避开「忽然」这类套话，审侧却把
    「忽然」当成冲突与钩子的存在证据。于是一段全是套话、毫无真实阻碍的文字只要写了「忽然」
    就能骗过冲突检查——判据被套话污染成假阴性。在构造期剔交集，往词表加词也不会踩回去。

    只约束「缺席即问题」的词表；`telling_markers` 那种「命中即问题」的与套话表同向，无需处理。
    """

    return tuple(marker for marker in markers if marker not in CLICHE_PHRASES)


CONFLICT_MARKERS = _absence_markers("但", "却", "然而", "忽然", "突然", "逼", "拦", "威胁", "冲突", "质问")
ENDING_HOOK_MARKERS = _absence_markers("？", "?", "却", "忽然", "门外", "电话", "消息", "血", "真相", "秘密")
MOTIVATION_MARKERS = _absence_markers("因为", "为了", "想", "决定", "害怕", "不敢", "必须", "答应", "拒绝")


@dataclass(frozen=True)
class ReviewIssue:
    agent: str
    severity: str
    code: str
    message: str
    evidence: str

    def as_dict(self) -> dict[str, str]:
        return {
            "agent": self.agent,
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
            "evidence": self.evidence,
        }


@dataclass(frozen=True)
class ReviewSkill:
    agent: str
    focus: str


REVIEW_SKILLS: dict[str, ReviewSkill] = {
    "plot": ReviewSkill(agent="plot-agent", focus="剧情结构、冲突推进、章尾钩子"),
    "character": ReviewSkill(agent="character-agent", focus="人物动机、称谓、关系一致性"),
    "prose": ReviewSkill(agent="prose-agent", focus="文风、节奏、信息密度"),
}


def review_context_summary(context_bundle: dict[str, Any] | None) -> dict[str, Any]:
    files = context_bundle.get("files") if isinstance(context_bundle, dict) else None
    context_files = [item for item in files if isinstance(item, dict)] if isinstance(files, list) else []
    kinds = sorted(
        {
            kind
            for item in context_files
            if isinstance((kind := item.get("kind")), str) and kind.strip()
        }
    )
    return {
        "file_count": len(context_files),
        "kinds": kinds,
        "files": [
            {
                "relative_path": item.get("relative_path") or item.get("relativePath") or item.get("path"),
                "kind": item.get("kind"),
                "title": item.get("title"),
            }
            for item in context_files[:8]
        ],
    }


def plot_agent_issues(content: str, paragraphs: list[str]) -> list[dict[str, str]]:
    issues: list[ReviewIssue] = []
    if len(content.strip()) < 240:
        issues.append(
            ReviewIssue(
                agent=REVIEW_SKILLS["plot"].agent,
                severity="medium",
                code="plot.too_short_for_scene",
                message="启发式信号：篇幅较短；尚未评估作者目标，不能据此认定场景不完整。",
                evidence="正文少于 240 字。",
            )
        )
    if not any(marker in content for marker in CONFLICT_MARKERS):
        issues.append(
            ReviewIssue(
                agent=REVIEW_SKILLS["plot"].agent,
                severity="high",
                code="plot.conflict_signal_missing",
                message="启发式信号：未见冲突关键词；尚未评估作者目标，静场不因此被判为问题。",
                evidence="未检测到转折、阻碍或对抗类关键词。",
            )
        )
    ending = paragraphs[-1] if paragraphs else content[-120:]
    if ending and not any(marker in ending for marker in ENDING_HOOK_MARKERS):
        issues.append(
            ReviewIssue(
                agent=REVIEW_SKILLS["plot"].agent,
                severity="medium",
                code="plot.ending_hook_weak",
                message="启发式信号：未见结尾钩子关键词；尚未评估作者目标，不代表必须补钩子。",
                evidence=_compact_text(ending, limit=120),
            )
        )
    return [issue.as_dict() for issue in issues]


def character_agent_issues(content: str, context_bundle: dict[str, Any] | None) -> list[dict[str, str]]:
    issues: list[ReviewIssue] = []
    context = review_context_summary(context_bundle)
    if "character" not in context["kinds"] and any(word in content for word in ("他", "她", "我", "你")):
        issues.append(
            ReviewIssue(
                agent=REVIEW_SKILLS["character"].agent,
                severity="medium",
                code="character.context_missing",
                message="本轮上下文未包含人物资料，人物动机和关系一致性只能做弱检查。",
                evidence="context_bundle 中没有 character 类型文件。",
            )
        )
    if len(content.strip()) >= 240 and not any(marker in content for marker in MOTIVATION_MARKERS):
        issues.append(
            ReviewIssue(
                agent=REVIEW_SKILLS["character"].agent,
                severity="medium",
                code="character.motivation_underexplained",
                message="启发式信号：未见动机关键词；尚未评估作者目标，刻意隐藏动机不因此被判为问题。",
                evidence="未检测到明显动机或选择类表达。",
            )
        )
    return [issue.as_dict() for issue in issues]


def prose_agent_issues(content: str, paragraphs: list[str]) -> list[dict[str, str]]:
    issues: list[ReviewIssue] = []
    telling_markers = ("说明", "显然", "其实", "事实上", "这意味着", "让人觉得")
    telling_hits = [marker for marker in telling_markers if marker in content]
    if telling_hits:
        issues.append(
            ReviewIssue(
                agent=REVIEW_SKILLS["prose"].agent,
                severity="medium",
                code="prose.telling_over_showing",
                message="启发式信号：出现解释性表达；尚未评估作者目标，不能据此否定作者保留的说明。",
                evidence=f"检测到：{', '.join(telling_hits)}",
            )
        )
    long_paragraphs = [paragraph for paragraph in paragraphs if len(paragraph) > 280]
    if long_paragraphs:
        issues.append(
            ReviewIssue(
                agent=REVIEW_SKILLS["prose"].agent,
                severity="low",
                code="prose.paragraph_too_dense",
                message="启发式信号：存在长段落；尚未评估作者目标，需结合刻意节奏核查阅读负担。",
                evidence=_compact_text(long_paragraphs[0], limit=120),
            )
        )
    return [issue.as_dict() for issue in issues]


def suggested_actions_for_review(
    *,
    plot_issues: list[dict[str, str]],
    character_issues: list[dict[str, str]],
    prose_issues: list[dict[str, str]],
) -> list[str]:
    actions: list[str] = []
    if plot_issues:
        actions.append("先按作者目标核查剧情问题；静场、留白或过渡不因缺少转折与钩子而必须改写。")
    if character_issues:
        actions.append("按作者目标核对人物与关系，仅处理有依据的矛盾，保留刻意隐藏的动机。")
    if prose_issues:
        actions.append("按作者目标核查语言问题，逐字保留明确要求保留的说明与情绪命名，不统一改成画面化表达。")
    if not actions:
        actions.append("本轮未报告问题，不代表已证明文学质量或已核实所有作者要求；是否继续由作者决定。")
    return actions


def _compact_text(value: object, *, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    return text if len(text) <= limit else f"{text[:limit].rstrip()}..."
