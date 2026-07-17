"""伏笔承诺记账：读取作者声明，分层返回确定性 blocking 与 advisory 信号。

`canon.json.invariants.promises` 是作者维护的承诺账本。本模块不抽取、不补写声明，
也不写任何派生缓存：项目 wrapper 只负责读取 canon 与复用正文路径阅读序，纯规则函数
负责无歧义的声明矛盾和需作者核实的跨章提醒。

blocking 只描述声明内部结构事实；advisory 的检测条件确定，但是否需要修改仍由作者
结合原文判断。issue id 镜像 canon gate 的 sha1 稳定形状，使用独立 `promise_` 前缀。
"""

from __future__ import annotations

from collections import Counter
from hashlib import sha1
from typing import Any

from app.domains.agent_runs import canon_rebuild, canon_store

DEFAULT_STALE_AFTER_CHAPTERS = 30

_ACTIVE_UNRESOLVED_STATUSES = frozenset({"planted", "advancing"})


def _issue_id(parts: list[str]) -> str:
    raw = "|".join(parts)
    return f"promise_{sha1(raw.encode('utf-8')).hexdigest()[:12]}"


def _promise_id(entry: dict[str, Any]) -> str | None:
    value = entry.get("id")
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def _chapter(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        return None
    return value


def _title(entry: dict[str, Any]) -> str | None:
    value = entry.get("title")
    return value.strip() if isinstance(value, str) and value.strip() else None


def _last_touch(entry: dict[str, Any], planted_chapter: int) -> int:
    touches = entry.get("touches")
    last_touch = _chapter(touches[-1]) if isinstance(touches, list) and touches else None
    return max(planted_chapter, last_touch or planted_chapter)


def _issue(
    category: str,
    severity: str,
    promise_id: str,
    message: str,
    *,
    id_parts: list[str] | None = None,
    title: str | None = None,
    **fields: Any,
) -> dict[str, Any]:
    issue: dict[str, Any] = {
        "id": _issue_id([category, promise_id, *(id_parts or [])]),
        "category": category,
        "severity": severity,
        "promise_id": promise_id,
        "message": message,
        **fields,
    }
    if title is not None:
        issue["title"] = title
    return issue


def _dedupe(issues: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for issue in issues:
        if issue["id"] in seen:
            continue
        seen.add(issue["id"])
        result.append(issue)
    return result


def check_promises(
    canon: dict[str, Any],
    current_chapter: int,
    *,
    stale_after_chapters: int = DEFAULT_STALE_AFTER_CHAPTERS,
) -> dict[str, Any]:
    """检查 promises 声明；坏类型只跳过依赖它的规则，不补造默认事实。"""

    if isinstance(current_chapter, bool) or not isinstance(current_chapter, int) or current_chapter < 0:
        raise ValueError("current_chapter 必须是非负整数。")
    if (
        isinstance(stale_after_chapters, bool)
        or not isinstance(stale_after_chapters, int)
        or stale_after_chapters < 1
    ):
        raise ValueError("stale_after_chapters 必须是正整数。")

    invariants = canon.get("invariants")
    raw_promises = invariants.get("promises") if isinstance(invariants, dict) else None
    promises = [
        entry
        for entry in raw_promises
        if isinstance(entry, dict) and _promise_id(entry) is not None
    ] if isinstance(raw_promises, list) else []

    promise_ids = [_promise_id(entry) for entry in promises]
    checked_promises = list(dict.fromkeys(promise_id for promise_id in promise_ids if promise_id is not None))
    id_counts = Counter(promise_id for promise_id in promise_ids if promise_id is not None)

    conflicts: list[dict[str, Any]] = []
    advisories: list[dict[str, Any]] = []

    for promise_id, count in id_counts.items():
        if count < 2:
            continue
        conflicts.append(
            _issue(
                "duplicate_id",
                "blocking",
                promise_id,
                f"伏笔承诺 id「{promise_id}」重复声明（{count} 条），稳定 id 必须唯一。",
                occurrences=count,
            )
        )

    for entry in promises:
        promise_id = _promise_id(entry)
        if promise_id is None:
            continue
        title = _title(entry)
        label = title or promise_id
        status = entry.get("status")
        kind = entry.get("kind")
        planted = _chapter(entry.get("planted_chapter"))
        due = _chapter(entry.get("due_chapter"))
        resolved = _chapter(entry.get("resolved_chapter"))

        if status == "resolved" and resolved is None:
            conflicts.append(
                _issue(
                    "resolved_chapter",
                    "blocking",
                    promise_id,
                    f"伏笔承诺「{label}」标记为 resolved，但 resolved_chapter 缺失或非法。",
                    title=title,
                    status="resolved",
                )
            )
        if planted is not None and resolved is not None and resolved < planted:
            conflicts.append(
                _issue(
                    "resolved_before_planted",
                    "blocking",
                    promise_id,
                    f"伏笔承诺「{label}」在第 {resolved} 章兑现，早于第 {planted} 章埋设。",
                    id_parts=[str(planted), str(resolved)],
                    title=title,
                    planted_chapter=planted,
                    resolved_chapter=resolved,
                )
            )
        if planted is not None and due is not None and due < planted:
            conflicts.append(
                _issue(
                    "due_before_planted",
                    "blocking",
                    promise_id,
                    f"伏笔承诺「{label}」的截止章 {due} 早于埋设章 {planted}。",
                    id_parts=[str(planted), str(due)],
                    title=title,
                    planted_chapter=planted,
                    due_chapter=due,
                )
            )

        if status in _ACTIVE_UNRESOLVED_STATUSES and due is not None and current_chapter > due:
            advisories.append(
                _issue(
                    "overdue",
                    "medium",
                    promise_id,
                    f"伏笔承诺「{label}」已超过第 {due} 章截止窗口，当前正文到第 {current_chapter} 章仍未兑现。",
                    id_parts=[str(due)],
                    title=title,
                    status=status,
                    due_chapter=due,
                    current_chapter=current_chapter,
                )
            )

        due_is_explicitly_open = "due_chapter" in entry and entry.get("due_chapter") is None
        if status == "planted" and due_is_explicitly_open and planted is not None:
            last_touch = _last_touch(entry, planted)
            gap = current_chapter - last_touch
            if gap >= stale_after_chapters:
                advisories.append(
                    _issue(
                        "stalled",
                        "medium",
                        promise_id,
                        f"伏笔承诺「{label}」已有 {gap} 章未推进，请核实是否遗忘或仍需保留。",
                        id_parts=[str(last_touch), str(stale_after_chapters)],
                        title=title,
                        status="planted",
                        last_touch_chapter=last_touch,
                        current_chapter=current_chapter,
                        gap_chapters=gap,
                        stale_after_chapters=stale_after_chapters,
                    )
                )

        cadence = _chapter(entry.get("cadence_chapters"))
        if kind == "recurring" and planted is not None and cadence is not None:
            last_touch = _last_touch(entry, planted)
            gap = current_chapter - last_touch
            if gap > cadence:
                advisories.append(
                    _issue(
                        "cadence_gap",
                        "medium",
                        promise_id,
                        f"循环承诺「{label}」已间隔 {gap} 章未推进，超过每 {cadence} 章一次的 cadence。",
                        id_parts=[str(last_touch), str(cadence)],
                        title=title,
                        kind="recurring",
                        last_touch_chapter=last_touch,
                        current_chapter=current_chapter,
                        gap_chapters=gap,
                        cadence_chapters=cadence,
                    )
                )

    conflicts = _dedupe(conflicts)
    advisories = _dedupe(advisories)
    if not promises:
        summary = "canon.json 尚无有效 promises 声明；本次没有可检查项，也未补造伏笔数据。"
    elif conflicts or advisories:
        summary = (
            f"已检查 {len(promises)} 条伏笔承诺：发现 {len(conflicts)} 个 blocking 声明矛盾、"
            f"{len(advisories)} 个 advisory 提醒；advisory 需结合原文核实。"
        )
    else:
        summary = f"已检查 {len(promises)} 条伏笔承诺，未发现 blocking 矛盾或 advisory 提醒。"

    return {
        "current_chapter": current_chapter,
        "promise_count": len(promises),
        "checked_promises": checked_promises,
        "conflicts": conflicts,
        "advisories": advisories,
        "conflict_count": len(conflicts),
        "advisory_count": len(advisories),
        "summary": summary,
    }


def build_promise_ledger(
    canon: dict[str, Any],
    promise_output: dict[str, Any],
) -> list[dict[str, Any]]:
    """把作者 promises 声明投影成台账并挂上关联 issue（观测镜富 view 数据源）。

    只做字段校验与归并，不重算规则：issue 一律来自 check_promises 的输出，
    台账不自造状态结论。坏类型字段落 None，如实呈现而非补造默认值。
    """

    invariants = canon.get("invariants")
    raw_promises = invariants.get("promises") if isinstance(invariants, dict) else None
    promises = [
        entry
        for entry in raw_promises
        if isinstance(entry, dict) and _promise_id(entry) is not None
    ] if isinstance(raw_promises, list) else []

    issues_by_promise: dict[str, list[dict[str, Any]]] = {}
    for layer in ("conflicts", "advisories"):
        for issue in promise_output.get(layer) or []:
            promise_id = issue.get("promise_id")
            if not isinstance(promise_id, str):
                continue
            issues_by_promise.setdefault(promise_id, []).append(
                {
                    "id": issue.get("id"),
                    "category": issue.get("category"),
                    "severity": issue.get("severity"),
                    "message": issue.get("message"),
                }
            )

    ledger: list[dict[str, Any]] = []
    for entry in promises:
        promise_id = _promise_id(entry)
        if promise_id is None:
            continue
        planted = _chapter(entry.get("planted_chapter"))
        status = entry.get("status")
        kind = entry.get("kind")
        ledger.append(
            {
                "id": promise_id,
                "title": _title(entry),
                "status": status if isinstance(status, str) else None,
                "kind": kind if isinstance(kind, str) else None,
                "planted_chapter": planted,
                "due_chapter": _chapter(entry.get("due_chapter")),
                "resolved_chapter": _chapter(entry.get("resolved_chapter")),
                "last_touch_chapter": _last_touch(entry, planted) if planted is not None else None,
                "issues": issues_by_promise.get(promise_id, []),
            }
        )
    return ledger


def promise_check(
    project_root: str,
    *,
    stale_after_chapters: int = DEFAULT_STALE_AFTER_CHAPTERS,
) -> dict[str, Any]:
    """只读项目 wrapper：读取 canon，并按既有 Markdown 阅读序求当前最大章。"""

    canon = canon_store.read_canon(project_root)
    ordinals = canon_rebuild.chapter_ordinals(project_root, "*.md")
    current_chapter = max(ordinals.values(), default=0)
    return check_promises(canon, current_chapter, stale_after_chapters=stale_after_chapters)
