"""file.revise 的范围解析与最小改动契约。

把作者的修订指令（自然语言 + 显式参数 + 上一轮审稿报告）解析成一个可控的
revise scope：选中哪些 issue、纳入/排除哪些类别、附加哪些硬约束，以及修订是否
应被「最小改动契约」约束。这些都是纯函数，便于单测，与 AgentRuntime 状态无关。"""

from __future__ import annotations

import re
from typing import Any

from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs._text import ordered_unique as _ordered_unique
from app.domains.agent_runs._text import string_arg_list as _string_arg_list
from app.domains.ide import review_reasoning
from app.domains.ide.review_skills import REVIEW_SKILLS

# revise 默认「整文件进、整文件出」，模型容易顺手重写未点名处；narrow 修订统一附最小改动契约约束范围。
_MINIMAL_EDIT_CONTRACT = "\n".join(
    [
        "最小改动约束（必须严格遵守）：",
        "1. 只改动与本次指令直接相关的字句；其余段落、句子、标题与空行必须逐字原样保留，不得改写、润色、重排或调整标点。",
        "2. 不要改动文件开头的标题、frontmatter 或导出元信息。",
        "3. 仍输出修订后的完整正文，但未点名处必须与原文逐字一致。",
    ]
)

# narrow 修订却改动了大半原文，多半是模型越界重写；超过该比例即在结果里挂 scope_warning 让作者逐块复核。
_NARROW_REVISE_DRIFT_WARN_RATIO = 0.5


def _scoped_revise_instruction(instruction: str, review_report: dict[str, Any] | None, scope: dict[str, Any]) -> str:
    issues = _scope_issues(scope)
    actions = _review_report_actions(review_report)
    constraints = _scope_string_list(scope, "constraints")
    narrow = bool(scope.get("narrow"))
    if not narrow and not review_report and not constraints:
        return instruction
    blocks = [instruction]
    if narrow:
        blocks.append(_MINIMAL_EDIT_CONTRACT)
    if constraints:
        blocks.append("\n".join(["硬约束（必须遵守）：", *(f"{index}. {constraint}" for index, constraint in enumerate(constraints, start=1))]))
    if not review_report or (not issues and not actions):
        return "\n\n".join(blocks)[:4000]
    issue_lines = []
    for index, issue in enumerate(issues[:8], start=1):
        issue_id = _optional_string(issue.get("id"))
        category = _optional_string(issue.get("category")) or _issue_category(issue) or "review"
        agent = issue_id or _optional_string(issue.get("agent")) or category
        severity = _optional_string(issue.get("severity")) or "info"
        message = _optional_string(issue.get("message")) or "未命名问题"
        evidence = _optional_string(issue.get("evidence"))
        suffix = f" 证据：{evidence}" if evidence else ""
        issue_lines.append(f"{index}. [{agent}/{category}/{severity}] {message}{suffix}")
    action_lines = [f"{index}. {action}" for index, action in enumerate(actions[:6], start=1)]
    review_block = "\n".join(
        [
            "上一轮多视角审稿报告（已按本轮指令筛选范围）：",
            "有效问题：",
            *(issue_lines or ["无有效审稿问题。"]),
            "建议：",
            *(action_lines or ["按用户当前指令修订。"]),
        ]
    )
    blocks.append(review_block)
    blocks.append("请只处理上述有效审稿范围内的问题，并保持原有事实连续。")
    return "\n\n".join(blocks)[:4000]


def _resolve_revise_scope(review_report: dict[str, Any] | None, args: dict[str, Any]) -> dict[str, Any]:
    issues = _review_report_issues(review_report)
    instruction = _optional_string(args.get("instruction")) or ""
    valid_by_id = {issue_id: issue for issue in issues if isinstance((issue_id := issue.get("id")), str) and issue_id.strip()}
    explicit_selected_ids = _string_arg_list(args.get("selected_issue_ids"))
    inferred_selected_ids, unknown_ordinals = _selected_issue_ids_from_instruction(instruction, issues)
    selected_ids = explicit_selected_ids or inferred_selected_ids
    dropped_unknown_ids = [issue_id for issue_id in selected_ids if issue_id not in valid_by_id]
    dropped_unknown_ids.extend(unknown_ordinals)
    explicit_included_categories = _valid_categories(_string_arg_list(args.get("included_categories")))
    inferred_included_categories = _included_categories_from_instruction(instruction)
    included_categories = explicit_included_categories or inferred_included_categories
    excluded_categories = _valid_categories(_string_arg_list(args.get("excluded_categories")))
    excluded_categories = _ordered_unique([*excluded_categories, *_excluded_categories_from_instruction(instruction)])
    constraints = _ordered_unique([*_string_arg_list(args.get("revision_constraints")), *_revision_constraints_from_instruction(instruction)])
    if selected_ids:
        scoped_issues = [valid_by_id[issue_id] for issue_id in selected_ids if issue_id in valid_by_id]
    elif included_categories:
        included = set(included_categories)
        scoped_issues = [issue for issue in issues if _issue_category(issue) in included]
    else:
        scoped_issues = issues
    if excluded_categories:
        excluded = set(excluded_categories)
        scoped_issues = [issue for issue in scoped_issues if _issue_category(issue) not in excluded]
    issue_ids = [issue_id for issue in scoped_issues if isinstance((issue_id := issue.get("id")), str) and issue_id.strip()]
    categories = [category for category in (*review_reasoning.REVIEW_AGENT_KEYS, "continuity") if any(_issue_category(issue) == category for issue in scoped_issues)]
    has_explicit_scope = bool(selected_ids or included_categories or excluded_categories or constraints)
    narrow = has_explicit_scope or not _is_broad_revise(instruction)
    return {
        "issues": scoped_issues,
        "issue_ids": issue_ids,
        "categories": categories,
        "constraints": constraints,
        "dropped_unknown_ids": _ordered_unique(dropped_unknown_ids),
        "narrow": narrow,
    }


def _is_broad_revise(instruction: str) -> bool:
    """识别明确要求全文/通篇重写的指令；这类指令不应被最小改动契约束缚。"""

    return any(
        keyword in instruction
        for keyword in ("全文", "通篇", "整篇", "整体重写", "全部重写", "重写全文", "逐段重写", "推倒重来", "大改")
    )


def _public_revise_scope(scope: dict[str, Any]) -> dict[str, Any]:
    return {
        "issue_ids": _scope_string_list(scope, "issue_ids"),
        "categories": _scope_string_list(scope, "categories"),
        "constraints": _scope_string_list(scope, "constraints"),
        "dropped_unknown_ids": _scope_string_list(scope, "dropped_unknown_ids"),
    }


def _revise_drift_ratio(before: str, after: str) -> tuple[int, int, float]:
    """按行裁掉公共前后缀，返回（原文被改动行数, 原文总行数, 改动比例）。

    与前端 diff 面板同口径，用于判断 narrow 修订是否越界改了大半原文。"""

    before_lines = before.split("\n")
    after_lines = after.split("\n")
    prefix = 0
    while prefix < len(before_lines) and prefix < len(after_lines) and before_lines[prefix] == after_lines[prefix]:
        prefix += 1
    suffix = 0
    while (
        suffix + prefix < len(before_lines)
        and suffix + prefix < len(after_lines)
        and before_lines[len(before_lines) - 1 - suffix] == after_lines[len(after_lines) - 1 - suffix]
    ):
        suffix += 1
    total = len(before_lines)
    changed = max(0, total - prefix - suffix)
    ratio = changed / total if total else (1.0 if changed else 0.0)
    return changed, total, ratio


def _scope_warning(scope: dict[str, Any], before: str, after: str) -> dict[str, Any] | None:
    """narrow 修订改动比例超阈值时，给出可见的越界提醒（不阻断，仅提示逐块复核）。"""

    if not scope.get("narrow"):
        return None
    changed, total, ratio = _revise_drift_ratio(before, after)
    if ratio <= _NARROW_REVISE_DRIFT_WARN_RATIO:
        return None
    return {
        "message": (
            f"本次定向修订改动了约 {round(ratio * 100)}% 的原文行（{changed}/{total} 行），"
            "可能超出指定范围，请在 diff 面板逐块核对后再接受。"
        ),
        "drift_ratio": round(ratio, 4),
        "changed_lines": changed,
        "total_lines": total,
        "narrow": True,
    }


def _scope_issues(scope: dict[str, Any]) -> list[dict[str, Any]]:
    issues = scope.get("issues")
    return [item for item in issues if isinstance(item, dict)] if isinstance(issues, list) else []


def _scope_string_list(scope: dict[str, Any], key: str) -> list[str]:
    return _string_arg_list(scope.get(key))


def _valid_categories(values: list[str]) -> list[str]:
    allowed = {*review_reasoning.REVIEW_AGENT_KEYS, "continuity"}
    return _ordered_unique([value for value in values if value in allowed])


def _issue_category(issue: dict[str, Any]) -> str | None:
    category = issue.get("category")
    if isinstance(category, str) and category in {*review_reasoning.REVIEW_AGENT_KEYS, "continuity"}:
        return category
    agent = issue.get("agent")
    if isinstance(agent, str):
        for key in review_reasoning.REVIEW_AGENT_KEYS:
            if agent == REVIEW_SKILLS[key].agent:
                return key
        if agent == "continuity-agent":
            return "continuity"
    return None


def _selected_issue_ids_from_instruction(instruction: str, issues: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    selected: list[str] = []
    unknown: list[str] = []
    for raw in re.findall(r"第\s*([一二两三四五六七八九十\d]+)\s*[条项个]", instruction):
        index = _parse_ordinal(raw)
        if index is None:
            continue
        issue = issues[index - 1] if 0 < index <= len(issues) else None
        issue_id = issue.get("id") if isinstance(issue, dict) else None
        if isinstance(issue_id, str) and issue_id.strip():
            selected.append(issue_id)
        else:
            unknown.append(f"第{index}条")
    return _ordered_unique(selected), _ordered_unique(unknown)


def _parse_ordinal(raw: str) -> int | None:
    if raw.isdigit():
        value = int(raw)
        return value if value > 0 else None
    digits = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
    if raw == "十":
        return 10
    if raw.startswith("十") and len(raw) == 2:
        return 10 + digits.get(raw[1], 0)
    if raw.endswith("十") and len(raw) == 2:
        return digits.get(raw[0], 0) * 10
    if "十" in raw and len(raw) == 3:
        return digits.get(raw[0], 0) * 10 + digits.get(raw[2], 0)
    return digits.get(raw)


def _included_categories_from_instruction(instruction: str) -> list[str]:
    categories: list[str] = []
    if any(keyword in instruction for keyword in ("剧情", "结构", "冲突", "钩子", "主线")):
        categories.append("plot")
    if any(keyword in instruction for keyword in ("人物", "角色", "动机", "称谓", "关系")):
        categories.append("character")
    if any(keyword in instruction for keyword in ("文风", "语言", "行文", "润色", "节奏", "信息密度", "解释性")):
        categories.append("prose")
    if any(keyword in instruction for keyword in ("一致性", "设定", "伏笔", "时间线", "前后文", "连续性")):
        categories.append("continuity")
    if "只" not in instruction and "仅" not in instruction and "单独" not in instruction:
        return []
    return _ordered_unique(categories)


def _excluded_categories_from_instruction(instruction: str) -> list[str]:
    categories: list[str] = []
    exclusion_patterns = {
        "plot": ("不改剧情", "别改剧情", "不要改剧情", "不动剧情", "不改结构", "不要动结构"),
        "character": ("不改人物", "别改人物", "不要改人物", "不动人物", "不改角色"),
        "prose": ("不改文风", "别改文风", "不要改文风", "不动文风", "不改语言", "不动语言"),
        "continuity": ("不改设定", "不要改设定", "不动时间线", "不改伏笔"),
    }
    for category, patterns in exclusion_patterns.items():
        if any(pattern in instruction for pattern in patterns):
            categories.append(category)
    return categories


def _revision_constraints_from_instruction(instruction: str) -> list[str]:
    constraints = []
    for match in re.findall(r"(保留|不动|不要改|别改)([^，。；;,.!?！？\n]{1,20})", instruction):
        constraint = "".join(match).strip()
        if constraint:
            constraints.append(constraint)
    return _ordered_unique(constraints[:8])


def _revise_summary_with_scope(summary: str, scope: dict[str, Any]) -> str:
    dropped = _scope_string_list(scope, "dropped_unknown_ids")
    if not dropped:
        return summary
    return f"{summary} 已忽略不存在的审稿条目：{', '.join(dropped)}。"


def _review_report_issues(review_report: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not review_report:
        return []
    issues = review_report.get("issues")
    return [item for item in issues if isinstance(item, dict)] if isinstance(issues, list) else []


def _review_report_actions(review_report: dict[str, Any] | None) -> list[str]:
    if not review_report:
        return []
    actions = review_report.get("suggested_actions")
    return [item for item in actions if isinstance(item, str) and item.strip()] if isinstance(actions, list) else []


scoped_revise_instruction = _scoped_revise_instruction
resolve_revise_scope = _resolve_revise_scope
public_revise_scope = _public_revise_scope
scope_warning = _scope_warning
scope_issues = _scope_issues
revise_summary_with_scope = _revise_summary_with_scope
