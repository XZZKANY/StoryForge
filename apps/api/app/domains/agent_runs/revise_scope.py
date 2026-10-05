"""file.revise 的范围解析与最小改动契约。

把作者的修订指令（自然语言 + 显式参数 + 上一轮审稿报告）解析成一个可控的
revise scope：选中哪些 issue、纳入/排除哪些类别、附加哪些硬约束，以及修订是否
应被「最小改动契约」约束。这些都是纯函数，便于单测，与 AgentRuntime 状态无关。"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from app.common.punctuation import canonical_punctuation
from app.domains.agent_runs._text import optional_string as _optional_string
from app.domains.agent_runs._text import ordered_unique as _ordered_unique
from app.domains.agent_runs._text import string_arg_list as _string_arg_list
from app.domains.agent_runs.revise_delivery import compose_scoped_instruction
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
_ISSUE_ORDINAL = re.compile(r"第\s*([一二两三四五六七八九十\d]+)\s*[条项个]")


def _scoped_revise_instruction(instruction: str, review_report: dict[str, Any] | None, scope: dict[str, Any]) -> str:
    issues = _scope_issues(scope)
    constraints = _scope_string_list(scope, "constraints")
    narrow = bool(scope.get("narrow"))
    if not narrow and not review_report and not constraints:
        return instruction
    blocks = [instruction]
    if narrow:
        blocks.append(_MINIMAL_EDIT_CONTRACT)
    if constraints:
        blocks.append(
            "\n".join(
                [
                    "硬约束（必须遵守）：",
                    *(f"{index}. {constraint}" for index, constraint in enumerate(constraints, start=1)),
                ]
            )
        )
    # Global actions have no issue association. Only an explicitly broad,
    # unfiltered rewrite may consume them; selected issues carry their own action.
    all_issues = _review_report_issues(review_report)
    actions = _review_report_actions(review_report) if not narrow and issues == all_issues else []
    return compose_scoped_instruction(blocks, issues, actions)


def _resolve_revise_scope(
    review_report: dict[str, Any] | None,
    args: dict[str, Any],
    *,
    author_instruction: str | None = None,
) -> dict[str, Any]:
    issues = _review_report_issues(review_report)
    instruction = (
        author_instruction if author_instruction is not None else _optional_string(args.get("instruction")) or ""
    )
    if author_instruction is not None and _ISSUE_ORDINAL.search(author_instruction):
        # Explicit author ordinals also outrank a model's category exclusions.
        args = {**args, "selected_issue_ids": [], "included_categories": [], "excluded_categories": []}
    valid_by_id = {
        issue_id: issue for issue in issues if isinstance((issue_id := issue.get("id")), str) and issue_id.strip()
    }
    explicit_selected_ids = _string_arg_list(args.get("selected_issue_ids"))
    ordinal_categories = _included_categories_from_instruction(instruction) if author_instruction is not None else []
    ordinal_issues = (
        [issue for issue in issues if _issue_category(issue) in ordinal_categories] if ordinal_categories else issues
    )
    inferred_selected_ids, unknown_ordinals = _selected_issue_ids_from_instruction(instruction, ordinal_issues)
    if author_instruction is not None and unknown_ordinals:
        from app.domains.agent_runs.errors import AgentOrchestrationError

        raise AgentOrchestrationError("选中的审稿问题不存在，请按当前报告重新选择；未生成补丁。")
    selected_ids = (
        inferred_selected_ids
        if author_instruction is not None and inferred_selected_ids
        else explicit_selected_ids or inferred_selected_ids
    )
    dropped_unknown_ids = [issue_id for issue_id in selected_ids if issue_id not in valid_by_id]
    dropped_unknown_ids.extend(unknown_ordinals)
    explicit_included_categories = _valid_categories(_string_arg_list(args.get("included_categories")))
    inferred_included_categories = _included_categories_from_instruction(instruction)
    included_categories = explicit_included_categories or inferred_included_categories
    excluded_categories = _valid_categories(_string_arg_list(args.get("excluded_categories")))
    excluded_categories = _ordered_unique([*excluded_categories, *_excluded_categories_from_instruction(instruction)])
    constraints = _ordered_unique(
        [*_string_arg_list(args.get("revision_constraints")), *_revision_constraints_from_instruction(instruction)]
    )
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
    issue_ids = [
        issue_id for issue in scoped_issues if isinstance((issue_id := issue.get("id")), str) and issue_id.strip()
    ]
    categories = [
        category
        for category in (*review_reasoning.REVIEW_AGENT_KEYS, "continuity")
        if any(_issue_category(issue) == category for issue in scoped_issues)
    ]
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


def revision_references_review(instruction: str) -> bool:
    return bool(_ISSUE_ORDINAL.search(instruction)) or any(
        phrase in instruction for phrase in ("审稿报告", "审稿问题", "审稿意见", "上轮问题", "上一轮问题")
    )


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


def _revise_drift_counts(before: str, after: str) -> tuple[int, int, int]:
    """按非空行统计（原文被改动行数, 纯新增行数, 非空原文总行数）。

    只统计 difflib 对齐后 replace/delete 触及的原文行数，而不是首尾改动之间的包围跨度；
    另把 insert 的新增行数单列，便于展示层区分「改了原文行」与「净插入新内容」。"""

    before_lines = [line for line in canonical_punctuation(before).split("\n") if line.strip()]
    after_lines = [line for line in canonical_punctuation(after).split("\n") if line.strip()]
    total = len(before_lines)
    # 无非空原文行（空稿写正文）时无「原文」可越界，返回零。
    if total == 0:
        return 0, 0, 0
    # 中文正文空行极多，autojunk 会把它们当"常见元素"剔除而错位对齐（见 punctuation.py）。
    matcher = SequenceMatcher(None, before_lines, after_lines, autojunk=False)
    touched = 0
    inserted = 0
    for tag, before_start, before_end, after_start, after_end in matcher.get_opcodes():
        if tag == "equal":
            continue
        touched += before_end - before_start
        if tag == "insert":
            inserted += after_end - after_start
    return touched, inserted, total


def _revise_drift_ratio(before: str, after: str) -> tuple[int, int, float]:
    """按行统计真实改动行数，返回（原文被改动行数 + 新增行数, 原文总行数, 改动比例）。

    用于判断 narrow 修订是否越界改了大半原文。比较前先折叠易漂移的标点形态：
    模型顺手把中文引号换成直引号这类改动会让每一行都算「改动行」——实测一次零真实
    改动的纯标点漂移能把比例顶到 97%，越界警告因此沦为噪音。折叠后此处衡量的是实质
    改动比例，故不再与前端 diff 面板逐字同口径（后者要显示真实差异）。

    再只统计非空行：中文稿空行约占一半，把空行算进分母会把逐段重写稀释到阈值以下；
    空文件（全空行）总数即为 0，写正文也不误报。同时缩小 autojunk=False 行级 diff 的
    规模——空行密集时它可能退化到近似 O(n³)，只在非空行上比对即可缓解。

    分子是「触及的原文行 + 新增行」：纯插入的原文行数为 0，故并入 insert 的新增行数，
    否则「原文逐字未动、只新增大段内容」的越界改写完全不可见。比值可能超过 1（短文件
    纯插入），判据按该原始比值执行，文案展示另有封顶。"""

    touched, inserted, total = _revise_drift_counts(before, after)
    changed = touched + inserted
    ratio = changed / total if total else 0.0
    return changed, total, ratio


def _scope_warning(scope: dict[str, Any], before: str, after: str) -> dict[str, Any] | None:
    """narrow 修订改动比例超阈值时，给出可见的越界提醒（不阻断，仅提示逐块复核）。"""

    if not scope.get("narrow"):
        return None
    touched, inserted, total = _revise_drift_counts(before, after)
    changed = touched + inserted
    ratio = changed / total if total else 0.0
    if ratio <= _NARROW_REVISE_DRIFT_WARN_RATIO:
        return None
    # 短文件纯插入时 changed 会大于原文行数，原样展示会出现「改动了约 400% 的原文行（8/2 行）」
    # 这类自相矛盾文案；展示层按原文行数封顶、新增部分单列，判据（是否告警）不变。
    displayed_changed = min(changed, total)
    percent = min(round(ratio * 100), 100)
    inserted_suffix = f"+ 新增 {inserted} 行" if inserted else ""
    return {
        "message": (
            f"本次定向修订改动了约 {percent}% 的原文行（{displayed_changed}/{total} 行）{inserted_suffix}，"
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
    for raw in _ISSUE_ORDINAL.findall(instruction):
        index = _parse_ordinal(raw)
        if index is None:
            unknown.append(f"第{raw}条")
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
