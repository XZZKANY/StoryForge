"""场景约束头构建器：从 canon.json 确定性拼接每轮应推给模型的硬约束。

只读 canon.json（作者声明）+ 当前文件章序，不扫正文、无 LLM。
推出去的是「本章绝不能违反的约束」，O(场景实体数) 不随书长膨胀。
读失败 / 空声明 → 静默返回 None（非阻断），绝不拖垮聊天循环。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.domains.agent_runs.canon_rebuild import _chapter_ordinals
from app.domains.agent_runs.canon_store import read_canon, read_hooks
from app.domains.agent_runs.fs_tools import FsToolError


def _to_relative_posix(project_root: str, absolute_path: str) -> str | None:
    """绝对路径 → 相对于项目根的 posix 路径；跨平台安全、越界返回 None。"""
    try:
        root = Path(project_root).resolve()
        target = Path(absolute_path).resolve()
        return target.relative_to(root).as_posix()
    except (ValueError, OSError):
        return None


def _window_covers(entry: dict[str, Any], cur: int) -> bool:
    """entry 的章窗 [from_chapter, to_chapter] 是否覆盖当前章 cur（1-based）。"""
    from_ch = entry.get("from_chapter")
    lo = from_ch if isinstance(from_ch, int) and not isinstance(from_ch, bool) else 1
    to_ch = entry.get("to_chapter")
    if not isinstance(to_ch, int) or isinstance(to_ch, bool):
        return cur >= lo  # 开放窗口（无 to_chapter）视为从 lo 起持续生效
    return lo <= cur <= to_ch


def build_scene_constraint_block(project_root: str, current_file: str | None) -> str | None:
    """确定性拼接「当前场景硬约束头」；只读 canon.json + 章序，不扫正文。

    读失败 / 无约束返回 None，调用方静默跳过——push 是加分项，绝不拖垮聊天循环。
    """
    try:
        canon = read_canon(project_root)
    except FsToolError:
        return None

    invariants = canon.get("invariants") or {}

    # 实体 id → canonical_name 映射（lifespan 用 id 引用实体，显示时用人名）
    entities = canon.get("entities") or []
    name_by_id: dict[str, str] = {}
    for e in entities:
        eid = e.get("id")
        cname = e.get("canonical_name")
        if isinstance(eid, str) and isinstance(cname, str):
            name_by_id[eid] = cname

    # 当前文件的章序（阅读序）；非章节文件 / 越界 / 扫描失败 → None，退化为「全书硬约束 digest」
    cur: int | None = None
    if current_file:
        rel = _to_relative_posix(project_root, current_file)
        if rel is not None:
            try:
                ordinals = _chapter_ordinals(project_root, "*.md")
            except FsToolError:
                ordinals = {}
            cur = ordinals.get(rel)

    lines: list[str] = []

    # ① 唯一持有：窗口覆盖本章则推（无锚则全推）
    for e in invariants.get("single_holder") or []:
        if not isinstance(e, dict):
            continue
        if cur is not None and not _window_covers(e, cur):
            continue
        item = e.get("item")
        holder = e.get("holder")
        if not isinstance(item, str) or not isinstance(holder, str):
            continue
        if not item.strip() or not holder.strip():
            continue
        lines.append(f"·「{item}」唯一持有者 = {holder}；本章不得出现第二持有者。")

    # ② 已退场：退场章 < 本章（无锚则列出各自退场章）
    for e in invariants.get("lifespan") or []:
        if not isinstance(e, dict):
            continue
        exits_after = e.get("exits_after_chapter")
        if not isinstance(exits_after, int) or isinstance(exits_after, bool):
            continue
        entity_id = e.get("entity")
        if not isinstance(entity_id, str) or not entity_id.strip():
            continue
        display = name_by_id.get(entity_id, entity_id)
        reason = e.get("reason")
        reason_suffix = f"（{reason}）" if isinstance(reason, str) and reason.strip() else ""
        if cur is None:
            lines.append(f"·「{display}」于第 {exits_after} 章退场{reason_suffix}。")
        elif exits_after < cur:
            lines.append(
                f"·「{display}」已于第 {exits_after} 章退场{reason_suffix}"
                f"——本章若出现须为回忆 / 提及。"
            )

    hooks_block = _build_active_hooks_block(project_root, cur)

    if not lines and hooks_block is None:
        return None

    parts: list[str] = []
    if lines:
        anchor = f"（本文件 = 第 {cur} 章 · 阅读序）" if cur is not None else "（全书）"
        parts.append("[canon 硬约束 · 确定性 · 勿违背]" + anchor + "\n" + "\n".join(lines))
    if hooks_block is not None:
        parts.append(hooks_block)

    return "\n\n".join(parts)

_ACTIVE_STATUSES = frozenset({"active", "planted"})
_STALE_HOOK_THRESHOLD = 10  # 钩子超过 N 章未推进视为「陈旧」


def _build_active_hooks_block(project_root: str, cur: int | None) -> str | None:
    """拼接「活跃伏笔 · 待回收」块，只读 hooks.json；读失败 / 无活跃钩子 → None。

    陈旧检测：钩子的 planted_at.path（若有）映射到文件序，与当前章序 cur 比较。
    planted_at.chapter 仅用于展示（如「第 3 章埋」），不参与陈旧计算——因为章号与序偶有错位。
    路径不存在或未提供时不计入陈旧统计（不伪报）。
    """
    try:
        hooks_data = read_hooks(project_root)
    except FsToolError:
        return None

    active = [
        h for h in (hooks_data.get("hooks") or [])
        if isinstance(h, dict) and h.get("status") in _ACTIVE_STATUSES
    ]
    if not active:
        return None

    # 建一次文件序索引供陈旧检测使用
    try:
        ordinals = _chapter_ordinals(project_root, "*.md")
    except FsToolError:
        ordinals = {}

    stale_hooks: list[dict[str, Any]] = []
    lines: list[str] = []
    for h in active:
        desc = h.get("description", "")
        if not isinstance(desc, str) or not desc.strip():
            continue
        planted = h.get("planted_at") or {}
        display_ch = planted.get("chapter") if isinstance(planted, dict) else None
        ch_hint = f"（第 {display_ch} 章埋）" if isinstance(display_ch, int) else ""

        # 陈旧检测：用 planted_at.path 在文件序中查埋入时的序，与当前章序 cur 比较
        is_stale = False
        if cur is not None and isinstance(planted, dict):
            planted_path = planted.get("path")
            if isinstance(planted_path, str) and planted_path.strip():
                planted_ordinal = ordinals.get(planted_path.strip())
                if (
                    isinstance(planted_ordinal, int)
                    and planted_ordinal > 0
                    and cur > planted_ordinal
                    and (cur - planted_ordinal) > _STALE_HOOK_THRESHOLD
                ):
                    is_stale = True
                    stale_hooks.append(h)

        cat = h.get("category", "")
        cat_hint = f"[{cat}]" if isinstance(cat, str) and cat.strip() else ""
        note = h.get("note", "")
        note_hint = f"——{note}" if isinstance(note, str) and note.strip() else ""
        prefix = f"{cat_hint} " if cat_hint else ""
        stale_marker = "⚠ " if is_stale else "· "
        lines.append(f"{stale_marker}{prefix}{desc}{ch_hint}{note_hint}")

    if not lines:
        return None

    block = "[活跃伏笔 · 待回收]\n" + "\n".join(lines)
    if stale_hooks:
        block += f"\n⚠ {len(stale_hooks)} 条伏笔超过 {_STALE_HOOK_THRESHOLD} 章未推进，请注意回收。"
    return block
