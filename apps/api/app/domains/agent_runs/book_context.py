"""作品底座：每轮对话开头确定性告诉模型「这是一本什么书、你现在在第几章」。

诊断（2026-07-30）：live 对话循环的 system prompt 里**没有任何全书事实**——文件树、
人物 / 设定索引、总章数、上一章结尾一概不进；唯一的全书事实源 `canon_context` 在作者
没声明 invariants 时整块返回 None。于是模型是个「空降的通用 agent，手里恰好攥着一份
文件」：它得自己想起来调工具，才知道正在写的是一部长篇而不是一份孤立文档。

本模块只做**确定性的廉价投影**，无 LLM、无 key：

- 章序复用 canon 的同一口径（`canon_rebuild.chapter_ordinals`），否则底座说「第 12 章」
  而硬约束头说「第 13 章」，两个数字打架比没有数字更糟；
- 字数按文件字节估算、不逐篇读盘，随书长增长的只是 stat 次数；
- 人物台账读 canon.json + **已落盘**的 presence.json 缓存，绝不触发重扫。

任何异常一律吞掉返回 None——底座是加分项，绝不能拖垮对话（与 `canon_context` 同规矩）。
"""

from __future__ import annotations

from pathlib import Path

from app.common.manuscript import is_manuscript_path, previous_chapter_tail
from app.domains.agent_runs import canon_rebuild, canon_store
from app.domains.agent_runs.fs_tools import FsToolError, iter_project_files, resolve_project_root

# 骨架索引只给路径 + 体量，让模型知道「有大纲可读」而不是把大纲塞进每一轮。
MAX_SKELETON_FILES = 12
# 人物台账超过这个数就不再是「谁在场」而是一份人物表，会稀释掉底座里真正要紧的坐标。
MAX_ROSTER_ENTITIES = 20
# 比产字路径的 1200 短一半：对话循环要的是「上一章怎么收的」，不是接笔所需的完整语感样本。
PREVIOUS_TAIL_MAX_CHARS = 600
# UTF-8 下中文一字三字节。逐篇读盘算准字数要 O(全书正文) 的 IO，每轮对话都做不划算；
# 估算值一律带「约」字交付，不冒充精确统计。
_BYTES_PER_CJK_CHAR = 3


def _estimated_chars(size_bytes: int) -> int:
    return size_bytes // _BYTES_PER_CJK_CHAR


def _format_chars(count: int) -> str:
    if count >= 10_000:
        return f"约 {count / 10_000:.1f} 万字"
    if count >= 1_000:
        return f"约 {count / 1_000:.1f} 千字"
    return f"约 {count} 字"


def _safe_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _scale_line(root: Path, ordinals: dict[str, int], current_relative: str | None) -> str:
    total_chapters = len(ordinals)
    total_bytes = sum(_safe_size(root / relative) for relative in ordinals)
    total_chars = _estimated_chars(total_bytes)

    parts = [f"全书 {total_chapters} 章正文 · {_format_chars(total_chars)}"]
    if total_chapters:
        parts.append(f"平均每章 {_format_chars(total_chars // total_chapters)}")

    current_ordinal = ordinals.get(current_relative) if current_relative else None
    if current_ordinal is not None:
        parts.append(f"当前打开的是第 {current_ordinal} 章（{current_relative}）")
    elif current_relative:
        parts.append(f"当前打开的 {current_relative} 不计入阅读序（非正文目录）")
    else:
        parts.append("当前没有打开正文")
    return "· " + "；".join(parts) + "。"


def _skeleton_lines(root: Path) -> list[str]:
    """大纲 / 人物 / 设定 / 时间线 / 伏笔等非正文 md 的索引（路径 + 体量，不含正文）。"""

    entries: list[tuple[str, int]] = []
    for path in iter_project_files(root):
        if path.suffix.lower() != ".md":
            continue
        relative = path.relative_to(root).as_posix()
        if is_manuscript_path(relative):
            continue
        entries.append((relative, _estimated_chars(_safe_size(path))))

    if not entries:
        return []
    lines = [
        f"· {relative}（{_format_chars(chars)}）"
        for relative, chars in entries[:MAX_SKELETON_FILES]
    ]
    if len(entries) > MAX_SKELETON_FILES:
        lines.append(f"· …另有 {len(entries) - MAX_SKELETON_FILES} 份，用 fs_list 看全。")
    return lines


def _roster_lines(project_root: str) -> list[str]:
    """canon.json 声明的实体台账：本名（别名）+ 出场章跨度。

    跨度取自 presence.json 缓存；缓存没落盘（作者还没跑过 project_canon）时只给名字与
    别名——**不在这里触发重扫**，那要扫全书正文，是每轮对话都付不起的代价。
    """

    try:
        canon = canon_store.read_canon(project_root)
    except FsToolError:
        return []
    entities = [item for item in (canon.get("entities") or []) if isinstance(item, dict)]
    if not entities:
        return []

    try:
        presence = canon_store.read_derived(project_root, "presence.json")
    except FsToolError:
        presence = None
    span_by_id: dict[str, tuple[int | None, int | None, bool]] = {}
    for item in (presence or {}).get("entities") or []:
        if not isinstance(item, dict):
            continue
        entity_id = item.get("id")
        if isinstance(entity_id, str):
            span_by_id[entity_id] = (
                item.get("first_chapter"),
                item.get("last_chapter"),
                bool(item.get("missing")),
            )

    lines: list[str] = []
    for entity in entities[:MAX_ROSTER_ENTITIES]:
        forms = canon_rebuild.entity_surface_forms(entity)
        if not forms:
            continue
        display = forms[0]
        if len(forms) > 1:
            display += f"（又称 {' / '.join(forms[1:4])}）"
        first, last, missing = span_by_id.get(str(entity.get("id")), (None, None, False))
        if missing:
            display += " · 正文中尚未登场"
        elif isinstance(first, int) and isinstance(last, int):
            display += f" · 第 {first}–{last} 章在场" if first != last else f" · 仅第 {first} 章在场"
        lines.append("· " + display)

    if not lines:
        return []
    if len(entities) > MAX_ROSTER_ENTITIES:
        lines.append(f"· …另有 {len(entities) - MAX_ROSTER_ENTITIES} 位，见 canon.json。")
    return lines


def _dossier_pointer(project_root: str) -> str | None:
    """已落盘的 dossier.md 指针。

    `fs_list` / `fs_search` 跳过 `.storyforge/`，模型永远发现不了这份全书事实卡；而
    `fs_read` 并不过滤该目录，知道路径就能读。缺的只是「知道它在那儿」这一句话。
    """

    dossier = Path(project_root) / ".storyforge" / "canon" / "derived" / "dossier.md"
    if not dossier.is_file():
        return None
    return (
        "· 全书事实卡（每实体身份 / 别名 / 出场跨度 / 声明来源）："
        ".storyforge/canon/derived/dossier.md —— fs_list 看不到它，但 fs_read 可以直接读这个路径。"
    )


def build_book_context_block(project_root: str, current_file: str | None) -> str | None:
    """确定性拼接「作品底座」system 块；无任何可报事实时返回 None，调用方静默跳过。"""

    try:
        root = resolve_project_root(project_root)
        ordinals = canon_rebuild.chapter_ordinals(project_root, "*.md")
    except (FsToolError, OSError):
        return None

    current_relative: str | None = None
    if current_file:
        try:
            current_relative = Path(current_file).resolve().relative_to(root).as_posix()
        except (ValueError, OSError):
            current_relative = None

    sections: list[str] = ["[作品底座 · 确定性]\n" + _scale_line(root, ordinals, current_relative)]

    try:
        skeleton = _skeleton_lines(root)
    except OSError:
        skeleton = []
    if skeleton:
        sections.append("[大纲 / 人物 / 设定索引 · 需要时用 fs_read 展开]\n" + "\n".join(skeleton))

    roster = _roster_lines(project_root)
    pointer = _dossier_pointer(project_root)
    if roster or pointer:
        body = "\n".join([*roster, *([pointer] if pointer else [])])
        sections.append("[已声明的人物 / 实体台账]\n" + body)

    previous = previous_chapter_tail(project_root, current_file, max_chars=PREVIOUS_TAIL_MAX_CHARS)
    if previous is not None:
        relative, tail = previous
        sections.append(f"[上一章结尾 · {relative}]\n{tail}")

    # 只有一个「0 章、没打开文件」的空壳时不值得占一个 system 位。
    if len(sections) == 1 and not ordinals:
        return None
    return "\n\n".join(sections)


__all__ = ["build_book_context_block"]
