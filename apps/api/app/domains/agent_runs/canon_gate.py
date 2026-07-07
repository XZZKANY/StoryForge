"""薄不变量闸：确定性硬矛盾 + advisory 分层（纯函数，无 LLM）。

输入作者声明的 canon（invariants）+ 从正文重建的 presence，输出稳定 issue 列表。
- 硬矛盾（可硬断）= 声明内部一致性：唯一持有章窗交叠、时间线声明成环——
  无歧义结构事实，移植 continuity/edge_constraints 的纯算法（_ranges_overlap +
  可达性回溯），但不进 DB、不接 continuity_edges 表（避免重引 book_id 耦合）。
- advisory（不硬断、提示作者核实）= 检测确定但语义存疑：声明退场后仍出场
  （可能是回忆 / 提及 / 同名）。
issue id 稳定（sha1 类别+关键字段，镜像 edge_constraints._conflict_id）。
"""

from __future__ import annotations

from hashlib import sha1
from typing import Any

# 移植自 edge_constraints：开放窗口哨兵 + 递归深度护栏（声明规模小，照搬即可）。
_OPEN_WINDOW = 10**9
_MAX_REACH_DEPTH = 64


def _issue_id(parts: list[str]) -> str:
    raw = "|".join(parts)
    return f"canon_{sha1(raw.encode('utf-8')).hexdigest()[:12]}"


def _ranges_overlap(
    left_from: int,
    left_to: int | None,
    right_from: int,
    right_to: int | None,
) -> bool:
    """章节区间交叠判定，纯 Python 移植 edge_constraints._ranges_overlap。"""

    left_end = left_to if left_to is not None else _OPEN_WINDOW
    right_end = right_to if right_to is not None else _OPEN_WINDOW
    return max(left_from, right_from) <= min(left_end, right_end)


def _as_int(value: Any, default: int) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def _check_single_holder(single_holder: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """同 item、不同 holder、章窗交叠 → blocking 硬矛盾。"""

    issues: list[dict[str, Any]] = []
    by_item: dict[str, list[dict[str, Any]]] = {}
    for entry in single_holder:
        item = entry.get("item")
        if isinstance(item, str) and item.strip():
            by_item.setdefault(item, []).append(entry)

    for item, entries in by_item.items():
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                left, right = entries[i], entries[j]
                if left.get("holder") == right.get("holder"):
                    continue
                if not _ranges_overlap(
                    _as_int(left.get("from_chapter"), 1),
                    left.get("to_chapter") if isinstance(left.get("to_chapter"), int) else None,
                    _as_int(right.get("from_chapter"), 1),
                    right.get("to_chapter") if isinstance(right.get("to_chapter"), int) else None,
                ):
                    continue
                holders = sorted([str(left.get("holder")), str(right.get("holder"))])
                issues.append(
                    {
                        "id": _issue_id(["single_holder", item, *holders]),
                        "category": "single_holder",
                        "severity": "blocking",
                        "item": item,
                        "holders": holders,
                        "message": f"唯一持有冲突：「{item}」在交叠章节窗口内同时被 {holders[0]} 与 {holders[1]} 持有。",
                    }
                )
    return issues


def _timeline_cycle_nodes(timeline_order: list[dict[str, Any]]) -> list[str] | None:
    """声明的 before→after 有向图成环检测（DFS + 深度护栏），返回环上节点或 None。"""

    adjacency: dict[str, list[str]] = {}
    for edge in timeline_order:
        before, after = edge.get("before"), edge.get("after")
        if isinstance(before, str) and before.strip() and isinstance(after, str) and after.strip():
            adjacency.setdefault(before, []).append(after)

    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {}

    def visit(node: str, stack: list[str], depth: int) -> list[str] | None:
        if depth > _MAX_REACH_DEPTH:
            return None
        color[node] = GRAY
        stack.append(node)
        for nxt in adjacency.get(node, []):
            state = color.get(nxt, WHITE)
            if state == GRAY:
                return stack[stack.index(nxt):] + [nxt]
            if state == WHITE:
                found = visit(nxt, stack, depth + 1)
                if found is not None:
                    return found
        stack.pop()
        color[node] = BLACK
        return None

    for start in adjacency:
        if color.get(start, WHITE) == WHITE:
            cycle = visit(start, [], 0)
            if cycle is not None:
                return cycle
    return None


def _check_timeline_order(timeline_order: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cycle = _timeline_cycle_nodes(timeline_order)
    if cycle is None:
        return []
    chain = " → ".join(cycle)
    return [
        {
            "id": _issue_id(["timeline_order", *cycle]),
            "category": "timeline_order",
            "severity": "blocking",
            "cycle": cycle,
            "message": f"时间线先后声明成环：{chain}，无法确定一致的先后顺序。",
        }
    ]


def _presence_by_entity(presence: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        entry["id"]: entry
        for entry in (presence.get("entities") or [])
        if isinstance(entry, dict) and entry.get("id") is not None
    }


def _check_lifespan(
    lifespan: list[dict[str, Any]],
    presence: dict[str, Any],
) -> list[dict[str, Any]]:
    """声明退场章之后仍出场 → advisory（检测确定，语义存疑：可能回忆 / 提及 / 同名）。"""

    issues: list[dict[str, Any]] = []
    by_entity = _presence_by_entity(presence)
    for entry in lifespan:
        entity_id = entry.get("entity")
        exits_after = entry.get("exits_after_chapter")
        if not isinstance(entity_id, str) or not isinstance(exits_after, int) or isinstance(exits_after, bool):
            continue
        record = by_entity.get(entity_id)
        if record is None:
            continue
        later = [
            occ
            for occ in (record.get("occurrences") or [])
            if isinstance(occ.get("chapter"), int) and occ["chapter"] > exits_after
        ]
        if not later:
            continue
        hits = [
            {"path": occ["path"], "chapter": occ["chapter"], "first_line": occ.get("first_line")}
            for occ in later
        ]
        reason = entry.get("reason")
        reason_hint = f"（声明原因：{reason}）" if isinstance(reason, str) and reason.strip() else ""
        issues.append(
            {
                "id": _issue_id(["lifespan", entity_id, str(exits_after)]),
                "category": "lifespan",
                "severity": "medium",
                "entity": entity_id,
                "exits_after_chapter": exits_after,
                "hits": hits,
                "message": (
                    f"{record.get('canonical_name') or entity_id} 声明在第 {exits_after} 章后退场{reason_hint}，"
                    f"但正文在其后章节仍出现其表面形（{len(hits)} 处）。可能是回忆 / 提及 / 同名，请抽读核实。"
                ),
            }
        )
    return issues


def check(canon: dict[str, Any], presence: dict[str, Any]) -> dict[str, Any]:
    """跑薄不变量闸，返回硬矛盾（conflicts）与 advisory 分层结果。"""

    invariants = canon.get("invariants") or {}
    single_holder = [e for e in (invariants.get("single_holder") or []) if isinstance(e, dict)]
    timeline_order = [e for e in (invariants.get("timeline_order") or []) if isinstance(e, dict)]
    lifespan = [e for e in (invariants.get("lifespan") or []) if isinstance(e, dict)]

    conflicts = _check_single_holder(single_holder) + _check_timeline_order(timeline_order)
    advisories = _check_lifespan(lifespan, presence)

    checked: list[str] = []
    if single_holder:
        checked.append("single_holder")
    if timeline_order:
        checked.append("timeline_order")
    if lifespan:
        checked.append("lifespan")

    return {
        "checked_invariants": checked,
        "conflicts": conflicts,
        "advisories": advisories,
        "conflict_count": len(conflicts),
        "advisory_count": len(advisories),
    }
