from __future__ import annotations

from dataclasses import dataclass
from typing import Any


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
                message="当前稿件篇幅偏短，可能还没有形成完整的场景目标、冲突推进和转折。",
                evidence="正文少于 240 字。",
            )
        )
    conflict_markers = ("但", "却", "然而", "忽然", "突然", "逼", "拦", "威胁", "冲突", "质问")
    if not any(marker in content for marker in conflict_markers):
        issues.append(
            ReviewIssue(
                agent=REVIEW_SKILLS["plot"].agent,
                severity="high",
                code="plot.conflict_signal_missing",
                message="没有明显冲突信号，章节可能缺少推动读者继续看的压力。",
                evidence="未检测到转折、阻碍或对抗类关键词。",
            )
        )
    ending = paragraphs[-1] if paragraphs else content[-120:]
    hook_markers = ("？", "?", "却", "忽然", "门外", "电话", "消息", "血", "真相", "秘密")
    if ending and not any(marker in ending for marker in hook_markers):
        issues.append(
            ReviewIssue(
                agent=REVIEW_SKILLS["plot"].agent,
                severity="medium",
                code="plot.ending_hook_weak",
                message="结尾钩子不够清晰，章尾可能缺少悬念或新的行动压力。",
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
    motivation_markers = ("因为", "为了", "想", "决定", "害怕", "不敢", "必须", "答应", "拒绝")
    if len(content.strip()) >= 240 and not any(marker in content for marker in motivation_markers):
        issues.append(
            ReviewIssue(
                agent=REVIEW_SKILLS["character"].agent,
                severity="medium",
                code="character.motivation_underexplained",
                message="人物行动动机不够显性，读者可能难以判断角色为什么这样做。",
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
                message="解释性表达偏多，可考虑改成动作、对话或感官细节。",
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
                message="存在过长段落，移动端阅读时信息密度可能过高。",
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
        actions.append("先补强章节目标、冲突推进或章尾钩子，再进入语言层修订。")
    if character_issues:
        actions.append("修订前核对人物小传和关系线，避免动机断裂。")
    if prose_issues:
        actions.append("压缩解释性句子，把关键信息改成动作、对话或场景证据。")
    if not actions:
        actions.append("当前稿件未发现明显结构性问题，可进入细节润色或导出。")
    return actions


def _compact_text(value: object, *, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    return text if len(text) <= limit else f"{text[:limit].rstrip()}..."
