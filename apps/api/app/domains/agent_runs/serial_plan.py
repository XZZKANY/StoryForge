"""连载计划：作者所有的 `.storyforge/serial-plan.json` + 确定性投影。

**为什么需要它**：agent 每轮拿得到「这是一本什么书、已经写到第几章」（`book_context`），
但拿不到「下一章该写什么」。缺这一口，编排权就只能留在 BookRun 那种外部状态机里——
作者每开一轮对话都得自己复述一遍计划，agent 永远是被动接单的。

**形状**：编排跨轮、不在轮内。计划落项目文件而非 DB run 实体，于是
`loop_runtime.LOOP_MAX_ROUNDS = 8`、工具输出预算和「一次对话最多一个补丁」三条限制
不再是墙——它们本来就是「一轮一章」的尺寸。作者说「继续」即调度器。

**真值源纪律**（本模块最要紧的一条）：手稿正文是唯一真值源，计划里的 `status` 只是声明。
两者不一致时**以正文为准并如实报出**——正文已存在就不再当待写章，哪怕计划仍标 pending。
否则 agent 会重写已写过的章，而这正是作者忘记调 `plan_update` 时的默认情形。

写盘红线：只写 `.storyforge/serial-plan.json`，绝不碰手稿正文；路径由 project_root
后端硬拼，不接受任何外部传入路径（同 `canon_store` 的授权边界）。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.domains.agent_runs import canon_rebuild
from app.domains.agent_runs.canon_store import atomic_write_json
from app.domains.agent_runs.fs_tools import FsToolError
from app.domains.agent_runs.fs_tools import resolve_project_root as _resolve_root

PLAN_RELATIVE_PATH = ".storyforge/serial-plan.json"

_STORYFORGE_DIRNAME = ".storyforge"
_PLAN_FILENAME = "serial-plan.json"

STATUS_PENDING = "pending"
STATUS_DONE = "done"
STATUS_BLOCKED = "blocked"
ALLOWED_STATUSES = frozenset({STATUS_PENDING, STATUS_DONE, STATUS_BLOCKED})

_EMPTY_PLAN: dict[str, Any] = {"version": 1, "chapters": [], "arcs": []}

# 计划块只报「下一章 + 紧随其后的几章」：再多就从坐标变成一份目录，把本轮真正要紧的
# 目标稀释掉（同 book_context 不把章节明细塞进 prompt 的取舍）。
UPCOMING_PREVIEW_COUNT = 3
# 计划与正文对不上时最多列这么多条，其余折叠成一句计数。
MAX_DRIFT_LINES = 5
# 单条目标超长就截断：计划是坐标不是大纲正文。
MAX_GOAL_CHARS = 200


@dataclass(frozen=True)
class PlannedChapter:
    """计划里的一章。`written` 来自正文实际存在与否，不是计划自己说的。"""

    ordinal: int
    title: str | None = None
    goal: str | None = None
    status: str = STATUS_PENDING
    note: str | None = None
    written: bool = False
    written_path: str | None = None

    @property
    def display_title(self) -> str:
        return f"第 {self.ordinal} 章" + (f"《{self.title}》" if self.title else "")

    @property
    def drifted(self) -> bool:
        """计划声明与正文事实对不上：写了却没标 done，或标了 done 却没正文。"""

        return self.written != (self.status == STATUS_DONE)


@dataclass(frozen=True)
class SerialPlan:
    premise: str | None = None
    chapter_word_count_min: int | None = None
    chapter_word_count_max: int | None = None
    chapters: list[PlannedChapter] = field(default_factory=list)
    arcs: list[dict[str, Any]] = field(default_factory=list)
    written_ordinals: frozenset[int] = frozenset()

    @property
    def planned_total(self) -> int:
        return len(self.chapters)

    @property
    def next_chapter(self) -> PlannedChapter | None:
        """下一章待写：正文里还不存在、且未被作者标记 blocked 的最小章序。

        以正文为准而非以 status 为准——作者忘了让 agent 标 done 时，
        按 status 挑会挑回一章已经写完的。
        """

        for chapter in self.chapters:
            if not chapter.written and chapter.status != STATUS_BLOCKED:
                return chapter
        return None

    @property
    def blocked_chapters(self) -> list[PlannedChapter]:
        return [c for c in self.chapters if c.status == STATUS_BLOCKED and not c.written]

    @property
    def drifted_chapters(self) -> list[PlannedChapter]:
        return [c for c in self.chapters if c.drifted]

    def upcoming(self, count: int = UPCOMING_PREVIEW_COUNT) -> list[PlannedChapter]:
        """下一章之后还没落正文的若干章（不含下一章本身）。"""

        following = [c for c in self.chapters if not c.written and c.status != STATUS_BLOCKED]
        return following[1 : count + 1]


def _plan_file(project_root: str) -> Path:
    """后端硬拼 `.storyforge/serial-plan.json` 绝对路径（不接受外部子路径）。"""

    return _resolve_root(project_root) / _STORYFORGE_DIRNAME / _PLAN_FILENAME


def read_plan(project_root: str) -> dict[str, Any]:
    """读作者的 serial-plan.json；不存在时明确返回空骨架（不伪造数据，明确空态）。"""

    plan_file = _plan_file(project_root)
    if not plan_file.is_file():
        return json.loads(json.dumps(_EMPTY_PLAN))
    try:
        parsed = json.loads(plan_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FsToolError(f"serial-plan.json 无法解析：{exc}") from exc
    if not isinstance(parsed, dict):
        raise FsToolError("serial-plan.json 顶层必须是 JSON 对象。")
    parsed.setdefault("version", 1)
    parsed.setdefault("chapters", [])
    parsed.setdefault("arcs", [])
    return parsed


def write_plan(project_root: str, payload: dict[str, Any]) -> str:
    """原子写 serial-plan.json（作者所有的连载计划，与 canon.json 同级）。"""

    plan_file = _plan_file(project_root)
    atomic_write_json(plan_file, payload)
    return str(plan_file)


def plan_exists(project_root: str) -> bool:
    try:
        return _plan_file(project_root).is_file()
    except (FsToolError, OSError):
        return False


def _clean_text(value: object, *, limit: int = MAX_GOAL_CHARS) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    return text[:limit]


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if value > 0 else None


def _written_ordinals(project_root: str) -> tuple[frozenset[int], dict[int, str]]:
    """正文实际落盘的章序集合。章序口径复用 canon_rebuild，与作品底座 / canon 闸同一把尺。"""

    try:
        ordinals = canon_rebuild.chapter_ordinals(project_root, "*.md")
    except (FsToolError, OSError):
        return frozenset(), {}
    path_by_ordinal = {ordinal: relative for relative, ordinal in ordinals.items()}
    return frozenset(path_by_ordinal), path_by_ordinal


def build_plan(project_root: str) -> SerialPlan | None:
    """确定性投影出连载计划；计划文件不存在或读不出章节时返回 None（调用方静默跳过）。"""

    try:
        raw = read_plan(project_root)
    except FsToolError:
        return None

    written, path_by_ordinal = _written_ordinals(project_root)

    chapters: list[PlannedChapter] = []
    for item in raw.get("chapters") or []:
        if not isinstance(item, dict):
            continue
        ordinal = _positive_int(item.get("ordinal"))
        if ordinal is None:
            continue
        status = item.get("status")
        chapters.append(
            PlannedChapter(
                ordinal=ordinal,
                title=_clean_text(item.get("title"), limit=80),
                goal=_clean_text(item.get("goal")),
                status=status if status in ALLOWED_STATUSES else STATUS_PENDING,
                note=_clean_text(item.get("note")),
                written=ordinal in written,
                written_path=path_by_ordinal.get(ordinal),
            )
        )
    if not chapters:
        return None
    chapters.sort(key=lambda chapter: chapter.ordinal)

    return SerialPlan(
        premise=_clean_text(raw.get("premise"), limit=300),
        chapter_word_count_min=_positive_int(raw.get("chapter_word_count_min")),
        chapter_word_count_max=_positive_int(raw.get("chapter_word_count_max")),
        chapters=chapters,
        arcs=[arc for arc in (raw.get("arcs") or []) if isinstance(arc, dict)],
        written_ordinals=written,
    )


def _progress_line(plan: SerialPlan) -> str:
    written_planned = sum(1 for chapter in plan.chapters if chapter.written)
    parts = [f"计划共 {plan.planned_total} 章", f"其中 {written_planned} 章正文已落盘"]
    if plan.chapter_word_count_min and plan.chapter_word_count_max:
        parts.append(f"每章目标 {plan.chapter_word_count_min}–{plan.chapter_word_count_max} 字")
    return "· " + "；".join(parts) + "。"


def _arc_lines(plan: SerialPlan, next_ordinal: int) -> list[str]:
    """与下一章相关的弧线：本章是目标章或兑现章的那几条。"""

    lines: list[str] = []
    for arc in plan.arcs:
        title = _clean_text(arc.get("title"), limit=60)
        if not title:
            continue
        targets = [t for t in (arc.get("target_chapters") or []) if isinstance(t, int)]
        payoff = _positive_int(arc.get("payoff_chapter"))
        if next_ordinal in targets:
            lines.append(f"· 「{title}」本章是推进点" + (f"，兑现在第 {payoff} 章" if payoff else ""))
        elif payoff == next_ordinal:
            lines.append(f"· 「{title}」本章是兑现章")
    return lines


def _drift_section(plan: SerialPlan) -> str | None:
    drifted = plan.drifted_chapters
    if not drifted:
        return None
    lines: list[str] = []
    for chapter in drifted[:MAX_DRIFT_LINES]:
        if chapter.written:
            lines.append(f"· {chapter.display_title}：正文已存在，但计划仍标 {chapter.status}")
        else:
            lines.append(f"· {chapter.display_title}：计划标 done，但正文里找不到这一章")
    if len(drifted) > MAX_DRIFT_LINES:
        lines.append(f"· …另有 {len(drifted) - MAX_DRIFT_LINES} 章对不上。")
    lines.append("以正文为准；确认后用 project_plan_update 把计划状态改对，不要照计划重写已有正文。")
    return "[计划与正文对不上]\n" + "\n".join(lines)


def render_plan_block(plan: SerialPlan) -> str | None:
    """把计划投影拼成 system 块；无可报事实时返回 None。"""

    sections: list[str] = []
    head = ["[连载计划 · 确定性]", _progress_line(plan)]
    if plan.premise:
        head.append(f"· 主线：{plan.premise}")
    sections.append("\n".join(head))

    nxt = plan.next_chapter
    if nxt is not None:
        lines = [f"· {nxt.display_title}"]
        if nxt.goal:
            lines.append(f"· 本章目标：{nxt.goal}")
        if nxt.note:
            lines.append(f"· 备注：{nxt.note}")
        lines.extend(_arc_lines(plan, nxt.ordinal))
        sections.append("[下一章待写]\n" + "\n".join(lines))

        upcoming = plan.upcoming()
        if upcoming:
            preview = [
                f"· {chapter.display_title}" + (f"：{chapter.goal}" if chapter.goal else "")
                for chapter in upcoming
            ]
            sections.append("[再往后]\n" + "\n".join(preview))
    else:
        sections.append("[下一章待写]\n· 计划内的章节都已落正文；要继续写得先把新章加进计划。")

    blocked = plan.blocked_chapters
    if blocked:
        blocked_lines = [
            f"· {chapter.display_title}" + (f"：{chapter.note}" if chapter.note else "")
            for chapter in blocked[:MAX_DRIFT_LINES]
        ]
        sections.append("[作者标记卡住 · 别自作主张开写]\n" + "\n".join(blocked_lines))

    drift = _drift_section(plan)
    if drift:
        sections.append(drift)

    return "\n\n".join(sections)


def build_plan_block(project_root: str) -> str | None:
    """确定性拼接「连载计划」system 块；无计划时返回 None，调用方静默跳过。

    任何异常一律吞掉返回 None——计划块是加分项，绝不能拖垮对话（同 `book_context` 规矩）。
    """

    try:
        plan = build_plan(project_root)
    except (FsToolError, OSError):
        return None
    if plan is None:
        return None
    return render_plan_block(plan)


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
        ordinal = _positive_int(item.get("ordinal")) if isinstance(item, dict) else None
        if ordinal is not None:
            by_ordinal[ordinal] = dict(item)

    created = updated = removed = skipped = 0
    for item in chapters or []:
        if not isinstance(item, dict):
            skipped += 1
            continue
        ordinal = _positive_int(item.get("ordinal"))
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
                value = _clean_text(item.get(key), limit=80 if key == "title" else MAX_GOAL_CHARS)
                if value is None:
                    target.pop(key, None)
                else:
                    target[key] = value
        status = item.get("status")
        if isinstance(status, str) and status in ALLOWED_STATUSES:
            target["status"] = status
        by_ordinal[ordinal] = target

    for ordinal in remove_ordinals or []:
        if _positive_int(ordinal) is not None and by_ordinal.pop(ordinal, None) is not None:
            removed += 1

    merged["chapters"] = [by_ordinal[key] for key in sorted(by_ordinal)]

    if premise is not None:
        cleaned = _clean_text(premise, limit=300)
        if cleaned is None:
            merged.pop("premise", None)
        else:
            merged["premise"] = cleaned
    for key, value in (
        ("chapter_word_count_min", chapter_word_count_min),
        ("chapter_word_count_max", chapter_word_count_max),
    ):
        if value is not None and _positive_int(value) is not None:
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


def apply_plan_update(
    project_root: str,
    **updates: Any,
) -> dict[str, Any]:
    """读 → 合并 → 原子写，返回工具证据。缺计划文件时按空骨架起步（首次调用即建计划）。"""

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


def to_payload(plan: SerialPlan) -> dict[str, Any]:
    """交给桌面端的只读投影。作者看见的必须就是模型看见的那一份。"""

    return {
        "planned_total": plan.planned_total,
        "written_count": sum(1 for chapter in plan.chapters if chapter.written),
        "premise": plan.premise,
        "chapter_word_count_min": plan.chapter_word_count_min,
        "chapter_word_count_max": plan.chapter_word_count_max,
        "chapters": [
            {
                "ordinal": chapter.ordinal,
                "title": chapter.title,
                "goal": chapter.goal,
                "status": chapter.status,
                "note": chapter.note,
                "written": chapter.written,
                "written_path": chapter.written_path,
                "drifted": chapter.drifted,
            }
            for chapter in plan.chapters
        ],
        "next_ordinal": plan.next_chapter.ordinal if plan.next_chapter is not None else None,
        "drifted_count": len(plan.drifted_chapters),
        "prompt_block": render_plan_block(plan),
    }


__all__ = [
    "ALLOWED_STATUSES",
    "PLAN_RELATIVE_PATH",
    "STATUS_BLOCKED",
    "STATUS_DONE",
    "STATUS_PENDING",
    "PlannedChapter",
    "SerialPlan",
    "apply_plan_update",
    "build_plan",
    "build_plan_block",
    "merge_plan_payload",
    "plan_exists",
    "read_plan",
    "render_plan_block",
    "to_payload",
    "write_plan",
]
