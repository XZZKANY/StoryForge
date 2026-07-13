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
    agenda_block = _build_hook_agenda_block(project_root, cur)

    if not lines and hooks_block is None:
        return None

    parts: list[str] = []
    if lines:
        anchor = f"（本文件 = 第 {cur} 章 · 阅读序）" if cur is not None else "（全书）"
        parts.append("[canon 硬约束 · 确定性 · 勿违背]" + anchor + "\n" + "\n".join(lines))
    if hooks_block is not None:
        parts.append(hooks_block)
    if agenda_block is not None:
        parts.append(agenda_block)

    return "\n\n".join(parts)

_ACTIVE_STATUSES = frozenset({"active", "planted"})
_STALE_HOOK_THRESHOLD = 10  # 钩子超过 N 章未推进视为「陈旧」


def _resolve_last_ordinal(
    hook: dict[str, Any],
    ordinals: dict[str, int],
    cur: int,
) -> tuple[int | None, str | None]:
    """解析伏笔的最后推进章序 & 说明标签。

    优先用 last_advanced_at.path 测「自上次推进以来的沉睡章数」；
    无 last_advanced_at 时回退 planted_at.path 测「自埋入以来的总章数」。
    返回 (ordinal, label)，label 为 "埋" 或 "推进"。
    """
    last_adv = hook.get("last_advanced_at")
    if isinstance(last_adv, dict):
        adv_path = last_adv.get("path")
        if isinstance(adv_path, str) and adv_path.strip():
            adv_ordinal = ordinals.get(adv_path.strip())
            if isinstance(adv_ordinal, int) and adv_ordinal > 0:
                return adv_ordinal, "推进"

    planted = hook.get("planted_at")
    if isinstance(planted, dict):
        planted_path = planted.get("path")
        if isinstance(planted_path, str) and planted_path.strip():
            planted_ordinal = ordinals.get(planted_path.strip())
            if isinstance(planted_ordinal, int) and planted_ordinal > 0:
                return planted_ordinal, "埋"
    return None, None


def _build_active_hooks_block(project_root: str, cur: int | None) -> str | None:
    """拼接「活跃伏笔 · 待回收」块，只读 hooks.json；读失败 / 无活跃钩子 → None。

    陈旧检测：优先用 last_advanced_at.path（若存在），否则用 planted_at.path
    映射到文件序，与当前章序 cur 比较。
    均不存在或未提供时不计入陈旧统计（不伪报）。
    展示章号仅用 planted_at.chapter 字段（不做陈旧计算）。
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
    stale_detail: list[str] = []  # 用于汇总行——新增强化：每行显示沉睡章数
    lines: list[str] = []
    for h in active:
        desc = h.get("description", "")
        if not isinstance(desc, str) or not desc.strip():
            continue
        planted = h.get("planted_at") or {}
        display_ch = planted.get("chapter") if isinstance(planted, dict) else None
        ch_hint = f"（第 {display_ch} 章埋）" if isinstance(display_ch, int) else ""

        # 增强的陈旧检测：用 last_advanced_at（优先）或 planted_at 测沉睡章数
        is_stale = False
        if cur is not None:
            ref_ordinal, ref_label = _resolve_last_ordinal(h, ordinals, cur)
            if ref_ordinal is not None and cur > ref_ordinal:
                diff = cur - ref_ordinal
                if diff > _STALE_HOOK_THRESHOLD:
                    is_stale = True
                    stale_hooks.append(h)
                    stale_detail.append(
                        f"「{desc[:40]}」自第 {ref_ordinal} 章{ref_label}后已沉睡 {diff} 章"
                    )

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
    if stale_detail:
        block += "\n⚠ 伏笔健康：" + "；".join(stale_detail) + "。请评估是回收还是延长排期。"
    elif stale_hooks:
        block += f"\n⚠ {len(stale_hooks)} 条伏笔超过 {_STALE_HOOK_THRESHOLD} 章未推进，请注意回收。"
    return block


def _build_hook_agenda_block(project_root: str, cur: int | None) -> str | None:
    """从 hooks.json 读取当前章的 agenda 编排（advance / resolve），
    输出「本章伏笔计划」方向性指引块。

    hooks.json 顶层可选字段 agenda: {chapter_number: {advance: [hook_ids], resolve: [hook_ids]}}

    无 agenda / 当前章无编排 / 读失败 → None，调用方静默跳过。
    """
    if cur is None:
        return None  # 全书模式下无针对性编排

    try:
        hooks_data = read_hooks(project_root)
    except FsToolError:
        return None

    agenda = hooks_data.get("agenda") or {}
    chapter_plan = agenda.get(str(cur)) if isinstance(agenda, dict) else None
    if not isinstance(chapter_plan, dict):
        return None

    advance_ids = chapter_plan.get("advance") or []
    resolve_ids = chapter_plan.get("resolve") or []
    if not advance_ids and not resolve_ids:
        return None

    # 建立 id → hook 映射供查 desc
    hooks_map: dict[str, dict[str, Any]] = {}
    for h in hooks_data.get("hooks") or []:
        if isinstance(h, dict):
            hid = h.get("id")
            if isinstance(hid, str):
                hooks_map[hid] = h

    lines: list[str] = []
    if advance_ids:
        descs: list[str] = []
        for hid in advance_ids:
            h = hooks_map.get(hid)
            desc = (h.get("description") or hid) if h else hid
            descs.append(f"「{desc[:60]}」")
        if descs:
            lines.append("· 应推进：" + "、".join(descs))
    if resolve_ids:
        descs = []
        for hid in resolve_ids:
            h = hooks_map.get(hid)
            desc = (h.get("description") or hid) if h else hid
            descs.append(f"「{desc[:60]}」")
        if descs:
            lines.append("· 应回收：" + "、".join(descs))

    if not lines:
        return None

    return "[本章伏笔计划]\n" + "\n".join(lines)
