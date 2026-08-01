"""连载计划的推进侧：把一批章节更新并入既有计划并原子写回。

与 `serial_plan`（载体 + 只读投影，对齐 `book_context` 的「一份投影两种渲染」）分开：
那边随每轮对话被读，这边只在计划被改时跑，且是唯一会改计划的地方。

两个入口：
- `apply_plan_update` —— 循环工具 `project.plan_update`，模型主动推进。
- `mark_chapter_written` —— 作者接受补丁、正文真的落盘之后由桌面端回调（`plan.mark_written`）。
  补上了那个真实缺口：此前「谁在接受之后标 done」没人负责，得等作者下一轮开口，
  中间计划一直显示 pending、每轮 prompt 都白带一段「计划与正文对不上」。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.domains.agent_runs import canon_rebuild
from app.domains.agent_runs.fs_tools import FsToolError, resolve_project_root
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
        for key in ("title", "goal", "note", "path"):
            if key in item:
                limit = 80 if key == "title" else (400 if key == "path" else MAX_GOAL_CHARS)
                value = clean_text(item.get(key), limit=limit)
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

def _with_stamped_paths(updates: dict[str, Any], project_root: str) -> dict[str, Any]:
    """给要标 done 的章补盖正文相对路径（后端算，不接受模型传）。

    路径是后来「按路径认章」的唯一凭据（见 `PlannedChapter.declared_path`）：章序会因正文
    空缺整体前移，撤销一次新建正好制造这种空缺。模型不该有机会往计划里写路径——它猜错一个，
    后面按路径认章就全认到别处去了。
    """

    chapters = updates.get("chapters")
    if not chapters:
        return updates
    _, path_by_ordinal = written_ordinals(project_root)
    stamped: list[dict[str, Any]] = []
    for item in chapters:
        if not isinstance(item, dict):
            stamped.append(item)
            continue
        ordinal = positive_int(item.get("ordinal"))
        relative = path_by_ordinal.get(ordinal) if ordinal is not None else None
        if item.get("status") == STATUS_DONE and relative:
            stamped.append({**item, "path": relative})
        else:
            stamped.append(item)
    return {**updates, "chapters": stamped}


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
    merged, counts = merge_plan_payload(existing, **_with_stamped_paths(updates, project_root))
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


def _relative_manuscript_path(project_root: str, file_path: str) -> str | None:
    """把补丁的目标路径归一成相对项目根的 posix 路径；越界或读不到项目时 None。"""

    try:
        root = resolve_project_root(project_root)
        candidate = Path(file_path)
        resolved = candidate if candidate.is_absolute() else root / candidate
        return resolved.resolve().relative_to(root).as_posix()
    except (FsToolError, OSError, ValueError):
        return None


def mark_chapter_written(project_root: str, file_path: str) -> dict[str, Any]:
    """作者接受补丁、正文落盘后把对应章标 done。返回是否真的改了 + 没改的原因。

    刻意保守的三条（回调在**每次**接受补丁时都会响，不能替作者无中生有）：

    - 计划文件不存在 → 不建计划。没在用连载计划的项目不该因为接受了一个补丁就被塞一份。
    - 该章不在计划里 → 不追加条目。agent 写了计划外的一章是作者要知道的事，
      悄悄补进计划等于把它抹平；模型想登记可以自己调 `project.plan_update`。
    - 正文实际不存在 → 不标。与 `reject_premature_done` 同一条真值源纪律：
      写盘失败或路径对不上时，宁可什么都不做，也不让计划替正文说话。

    一律不抛异常：这是写盘成功之后的收尾动作，失败不该回头污染已经成功的写回。
    """
    relative = _relative_manuscript_path(project_root, file_path)
    if relative is None:
        return {"updated": False, "reason": "path_outside_project"}

    try:
        ordinals = canon_rebuild.chapter_ordinals(project_root, "*.md")
    except (FsToolError, OSError):
        return {"updated": False, "reason": "project_unreadable"}
    ordinal = ordinals.get(relative)
    if ordinal is None:
        # 设定 / 人物这类非正文，或正文还没落盘 —— 都不是「写完一章」。
        return {"updated": False, "reason": "not_a_manuscript_chapter", "path": relative}

    try:
        existing = read_plan(project_root)
    except FsToolError:
        return {"updated": False, "reason": "plan_unreadable"}
    chapters = existing.get("chapters") or []
    if not chapters:
        return {"updated": False, "reason": "no_plan", "ordinal": ordinal}

    target = next(
        (
            item
            for item in chapters
            if isinstance(item, dict) and positive_int(item.get("ordinal")) == ordinal
        ),
        None,
    )
    if target is None:
        return {"updated": False, "reason": "chapter_not_in_plan", "ordinal": ordinal}
    if target.get("status") == STATUS_DONE:
        return {"updated": False, "reason": "already_done", "ordinal": ordinal}

    # 同时记下路径：撤销一次新建会删文件、把后面的章序整体前移，届时只有路径认得出是哪一章。
    merged, _counts = merge_plan_payload(
        existing, chapters=[{"ordinal": ordinal, "status": STATUS_DONE, "path": relative}]
    )
    write_plan(project_root, merged)
    plan = build_plan(project_root)
    next_chapter = plan.next_chapter if plan is not None else None
    return {
        "updated": True,
        "ordinal": ordinal,
        "path": relative,
        "next_ordinal": next_chapter.ordinal if next_chapter is not None else None,
        "next_goal": next_chapter.goal if next_chapter is not None else None,
        "plan_path": PLAN_RELATIVE_PATH,
    }


def unmark_chapter_written(project_root: str, file_path: str) -> dict[str, Any]:
    """作者撤销一次「新建」、正文被删之后，把对应章从 done 退回 pending。

    **只按记下的路径认章，不按章序**：章序是「路径序第几个」，删掉一个文件会让后面的章
    整体前移——正是撤销制造的那种空缺。按章序找会退错章，而且越靠后错得越离谱。

    仍然以正文为准：文件还在就什么都不做（修订的撤销走反向写回，那章依然是写完的）。
    认不出是哪一章（计划里没记过这个路径，比如 done 是本次改动之前标的）就如实说，不猜。

    与正向同样不抛异常：撤销已经成功了，收尾失败不该把它报成撤销失败。
    """

    relative = _relative_manuscript_path(project_root, file_path)
    if relative is None:
        return {"updated": False, "reason": "path_outside_project"}

    try:
        ordinals = canon_rebuild.chapter_ordinals(project_root, "*.md")
    except (FsToolError, OSError):
        return {"updated": False, "reason": "project_unreadable"}
    if relative in ordinals:
        # 正文还在（修订撤销 / 删除没成功）——那章仍然是写完的，不能退回 pending。
        return {"updated": False, "reason": "manuscript_still_exists", "path": relative}

    try:
        existing = read_plan(project_root)
    except FsToolError:
        return {"updated": False, "reason": "plan_unreadable"}
    chapters = existing.get("chapters") or []
    target = next(
        (
            item
            for item in chapters
            if isinstance(item, dict) and clean_text(item.get("path"), limit=400) == relative
        ),
        None,
    )
    if target is None:
        return {"updated": False, "reason": "chapter_not_identifiable", "path": relative}
    if target.get("status") != STATUS_DONE:
        return {"updated": False, "reason": "not_done", "path": relative}

    ordinal = positive_int(target.get("ordinal"))
    merged, _counts = merge_plan_payload(
        existing, chapters=[{"ordinal": ordinal, "status": STATUS_PENDING, "path": None}]
    )
    write_plan(project_root, merged)
    plan = build_plan(project_root)
    next_chapter = plan.next_chapter if plan is not None else None
    return {
        "updated": True,
        "ordinal": ordinal,
        "path": relative,
        "next_ordinal": next_chapter.ordinal if next_chapter is not None else None,
        "plan_path": PLAN_RELATIVE_PATH,
    }


__all__ = [
    "apply_plan_update",
    "mark_chapter_written",
    "merge_plan_payload",
    "reject_premature_done",
    "unmark_chapter_written",
]
