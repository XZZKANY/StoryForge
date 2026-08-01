"""连载计划的推进侧：把一批章节更新并入既有计划并原子写回。

与 `serial_plan`（载体 + 只读投影，对齐 `book_context` 的「一份投影两种渲染」）分开：
那边随每轮对话被读，这边只在 `project.plan_update` 被调时跑，且是唯一会改计划的地方。
"""

from __future__ import annotations

import json
from typing import Any

from app.domains.agent_runs.fs_tools import FsToolError
from app.domains.agent_runs.serial_plan import (
    ALLOWED_STATUSES,
    MAX_GOAL_CHARS,
    PLAN_RELATIVE_PATH,
    STATUS_DONE,
    STATUS_PENDING,
    build_plan,
    clean_text,
    positive_int,
    read_plan,
    write_plan,
    written_ordinals,
)

_EMPTY_PLAN: dict[str, Any] = {"version": 1, "chapters": [], "arcs": []}


def merge_plan_payload(
    existing: dict[str, Any],
    *,
    chapters: list[dict[str, Any]] | None = None,
    premise: str | None = None,
    chapter_word_count_min: int | None = None,
    chapter_word_count_max: int | None = None,
    arcs: list[dict[str, Any]] | None = None,
    remove_ordinals: list[int] | None = None,
) -> tuple[dict[str, Any], dict[str, int]]:
    """把一批章节更新并入既有计划，返回 `(新计划, 计数证据)`。纯函数：不读盘不写盘。

    按 `ordinal` upsert 并**逐字段合并**——未传的字段保留原值。否则 agent 只想标一句
    「第 12 章写完了」，就会把作者手写的 title / goal / note 一起清空。
    """

    merged = json.loads(json.dumps(existing)) if existing else json.loads(json.dumps(_EMPTY_PLAN))
    merged.setdefault("version", 1)
    by_ordinal: dict[int, dict[str, Any]] = {}
    for item in merged.get("chapters") or []:
        ordinal = positive_int(item.get("ordinal")) if isinstance(item, dict) else None
        if ordinal is not None:
            by_ordinal[ordinal] = dict(item)

    created = updated = removed = skipped = 0
    for item in chapters or []:
        if not isinstance(item, dict):
            skipped += 1
            continue
        ordinal = positive_int(item.get("ordinal"))
        if ordinal is None:
            skipped += 1
            continue
        target = by_ordinal.get(ordinal)
        if target is None:
            target = {"ordinal": ordinal, "status": STATUS_PENDING}
            created += 1
        else:
            target = dict(target)
            updated += 1
        for key in ("title", "goal", "note"):
            if key in item:
                value = clean_text(item.get(key), limit=80 if key == "title" else MAX_GOAL_CHARS)
                if value is None:
                    target.pop(key, None)
                else:
                    target[key] = value
        status = item.get("status")
        if isinstance(status, str) and status in ALLOWED_STATUSES:
            target["status"] = status
        by_ordinal[ordinal] = target

    for ordinal in remove_ordinals or []:
        if positive_int(ordinal) is not None and by_ordinal.pop(ordinal, None) is not None:
            removed += 1

    merged["chapters"] = [by_ordinal[key] for key in sorted(by_ordinal)]

    if premise is not None:
        cleaned = clean_text(premise, limit=300)
        if cleaned is None:
            merged.pop("premise", None)
        else:
            merged["premise"] = cleaned
    for key, value in (
        ("chapter_word_count_min", chapter_word_count_min),
        ("chapter_word_count_max", chapter_word_count_max),
    ):
        if value is not None and positive_int(value) is not None:
            merged[key] = value
    if arcs is not None:
        merged["arcs"] = [arc for arc in arcs if isinstance(arc, dict)]
    merged.setdefault("arcs", [])

    counts = {
        "created_count": created,
        "updated_count": updated,
        "removed_count": removed,
        "skipped_count": skipped,
    }
    return merged, counts


def reject_premature_done(
    chapters: list[dict[str, Any]] | None,
    written: frozenset[int],
) -> list[int]:
    """挑出「正文还不存在却要标 done」的章序。纯函数，便于单测。

    2026-08-01 真跑实测（deepseek-v4-flash）：模型起草完一章的**待确认补丁**后，同一轮就把
    该章标 done——可补丁得作者点接受才落盘，此刻正文根本不存在。计划于是在作者决定之前
    就开始说谎，模型还据此回话「已标记完成」。同一次实测里它在另一个场景又说「确认后我
    把第 3 章标 done」，说明它知道规矩、只是记不牢——这种事不能靠 prompt 多写一句话兜。
    """

    return sorted(
        ordinal
        for item in chapters or []
        if isinstance(item, dict)
        and item.get("status") == STATUS_DONE
        and (ordinal := positive_int(item.get("ordinal"))) is not None
        and ordinal not in written
    )


def apply_plan_update(
    project_root: str,
    **updates: Any,
) -> dict[str, Any]:
    """读 → 合并 → 原子写，返回工具证据。缺计划文件时按空骨架起步（首次调用即建计划）。

    正文不存在就不许标 done（见 `reject_premature_done`）：整调用报错，让模型收到反馈后
    改口，而不是默默降级——默默降级会留下模型已经对作者说出口的那句「已标记完成」。
    """

    written, _ = written_ordinals(project_root)
    premature = reject_premature_done(updates.get("chapters"), written)
    if premature:
        listed = "、".join(f"第 {ordinal} 章" for ordinal in premature)
        raise FsToolError(
            f"{listed}的正文还不存在，不能标 done。起草补丁不等于落盘——"
            "补丁要作者在界面点接受才写进正文，请等作者接受后再标记；"
            "本次调用未改动计划，回话时也不要说这章已完成。"
        )

    existing = read_plan(project_root)
    merged, counts = merge_plan_payload(existing, **updates)
    plan_path = write_plan(project_root, merged)

    plan = build_plan(project_root)
    next_chapter = plan.next_chapter if plan is not None else None
    return {
        "plan_path": PLAN_RELATIVE_PATH,
        "planned_total": plan.planned_total if plan is not None else 0,
        "next_ordinal": next_chapter.ordinal if next_chapter is not None else None,
        "next_goal": next_chapter.goal if next_chapter is not None else None,
        "drifted_count": len(plan.drifted_chapters) if plan is not None else 0,
        "written_path": plan_path,
        **counts,
    }


__all__ = [
    "apply_plan_update",
    "merge_plan_payload",
    "reject_premature_done",
]
