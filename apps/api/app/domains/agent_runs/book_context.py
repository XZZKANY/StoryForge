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

**一份投影，两种渲染**（2026-07-30 二次拆分）：`build_book_context` 产出结构化事实，
`render_book_context_block` 把它拼成 system 文本，`to_payload` 把它交给桌面端左栏。
此前只有文本出口，作者要想看见「模型这轮到底拿到了什么」，前端只能自己另算一遍——
那就会出现面板与模型口径不一致，比不显示更糟。章节明细只进 payload 不进 prompt：
模型有 fs_list，不需要每轮背一份目录。
"""

from __future__ import annotations

from dataclasses import dataclass, field
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
# 台账里每位最多显示 3 个别名，再多就把坐标淹了。
MAX_ROSTER_ALIASES = 3
# UTF-8 下中文一字三字节。逐篇读盘算准字数要 O(全书正文) 的 IO，每轮对话都做不划算；
# 估算值一律带「约」字交付，不冒充精确统计。
_BYTES_PER_CJK_CHAR = 3

DOSSIER_RELATIVE_PATH = ".storyforge/canon/derived/dossier.md"


@dataclass(frozen=True)
class ChapterEntry:
    """阅读序里的一章。`size_bytes` 保留原始字节：全书字数是 sum(bytes)//3，
    不是 sum(bytes//3)——按每章估算值累加会比 prompt 少几个字。"""

    ordinal: int
    relative_path: str
    size_bytes: int

    @property
    def estimated_chars(self) -> int:
        return _estimated_chars(self.size_bytes)


@dataclass(frozen=True)
class SkeletonFile:
    relative_path: str
    estimated_chars: int


@dataclass(frozen=True)
class RosterEntity:
    canonical_name: str
    aliases: list[str]
    first_chapter: int | None = None
    last_chapter: int | None = None
    missing: bool = False


@dataclass(frozen=True)
class BookContext:
    """作品底座的结构化事实。渲染成 prompt 文本或交给桌面端，都从这一份出。"""

    chapters: list[ChapterEntry] = field(default_factory=list)
    current_relative_path: str | None = None
    current_ordinal: int | None = None
    skeleton: list[SkeletonFile] = field(default_factory=list)
    skeleton_total: int = 0
    roster: list[RosterEntity] = field(default_factory=list)
    roster_declared_total: int = 0
    dossier_relative_path: str | None = None
    previous_chapter: tuple[str, str] | None = None

    @property
    def total_chapters(self) -> int:
        return len(self.chapters)

    @property
    def total_estimated_chars(self) -> int:
        return _estimated_chars(sum(chapter.size_bytes for chapter in self.chapters))


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


def _scale_line(context: BookContext) -> str:
    total_chapters = context.total_chapters
    total_chars = context.total_estimated_chars

    parts = [f"全书 {total_chapters} 章正文 · {_format_chars(total_chars)}"]
    if total_chapters:
        parts.append(f"平均每章 {_format_chars(total_chars // total_chapters)}")

    if context.current_ordinal is not None:
        parts.append(
            f"当前打开的是第 {context.current_ordinal} 章（{context.current_relative_path}）"
        )
    elif context.current_relative_path:
        parts.append(f"当前打开的 {context.current_relative_path} 不计入阅读序（非正文目录）")
    else:
        parts.append("当前没有打开正文")
    return "· " + "；".join(parts) + "。"


def _skeleton_files(root: Path) -> tuple[list[SkeletonFile], int]:
    """大纲 / 人物 / 设定 / 时间线 / 伏笔等非正文 md 的索引（路径 + 体量，不含正文）。"""

    entries: list[SkeletonFile] = []
    for path in iter_project_files(root):
        if path.suffix.lower() != ".md":
            continue
        relative = path.relative_to(root).as_posix()
        if is_manuscript_path(relative):
            continue
        entries.append(SkeletonFile(relative, _estimated_chars(_safe_size(path))))
    return entries[:MAX_SKELETON_FILES], len(entries)


def _roster_entities(project_root: str) -> tuple[list[RosterEntity], int]:
    """canon.json 声明的实体台账：本名（别名）+ 出场章跨度。

    跨度取自 presence.json 缓存；缓存没落盘（作者还没跑过 project_canon）时只给名字与
    别名——**不在这里触发重扫**，那要扫全书正文，是每轮对话都付不起的代价。
    """

    try:
        canon = canon_store.read_canon(project_root)
    except FsToolError:
        return [], 0
    entities = [item for item in (canon.get("entities") or []) if isinstance(item, dict)]
    if not entities:
        return [], 0

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

    roster: list[RosterEntity] = []
    for entity in entities[:MAX_ROSTER_ENTITIES]:
        forms = canon_rebuild.entity_surface_forms(entity)
        if not forms:
            continue
        first, last, missing = span_by_id.get(str(entity.get("id")), (None, None, False))
        roster.append(
            RosterEntity(
                canonical_name=forms[0],
                aliases=forms[1:],
                first_chapter=first if isinstance(first, int) else None,
                last_chapter=last if isinstance(last, int) else None,
                missing=missing,
            )
        )
    return roster, len(entities)


def _roster_display(entity: RosterEntity) -> str:
    display = entity.canonical_name
    if entity.aliases:
        display += f"（又称 {' / '.join(entity.aliases[:MAX_ROSTER_ALIASES])}）"
    if entity.missing:
        display += " · 正文中尚未登场"
    elif entity.first_chapter is not None and entity.last_chapter is not None:
        first, last = entity.first_chapter, entity.last_chapter
        display += f" · 第 {first}–{last} 章在场" if first != last else f" · 仅第 {first} 章在场"
    return display


def _dossier_relative_path(project_root: str) -> str | None:
    """已落盘的 dossier.md 指针。

    `fs_list` / `fs_search` 跳过 `.storyforge/`，模型永远发现不了这份全书事实卡；而
    `fs_read` 并不过滤该目录，知道路径就能读。缺的只是「知道它在那儿」这一句话。
    """

    dossier = Path(project_root) / ".storyforge" / "canon" / "derived" / "dossier.md"
    return DOSSIER_RELATIVE_PATH if dossier.is_file() else None


def build_book_context(project_root: str, current_file: str | None) -> BookContext | None:
    """确定性投影出作品底座事实；项目路径不可用时返回 None。"""

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

    chapters = [
        ChapterEntry(ordinal, relative, _safe_size(root / relative))
        for relative, ordinal in ordinals.items()
    ]

    try:
        skeleton, skeleton_total = _skeleton_files(root)
    except OSError:
        skeleton, skeleton_total = [], 0

    roster, roster_declared_total = _roster_entities(project_root)

    return BookContext(
        chapters=chapters,
        current_relative_path=current_relative,
        current_ordinal=ordinals.get(current_relative) if current_relative else None,
        skeleton=skeleton,
        skeleton_total=skeleton_total,
        roster=roster,
        roster_declared_total=roster_declared_total,
        dossier_relative_path=_dossier_relative_path(project_root),
        previous_chapter=previous_chapter_tail(
            project_root, current_file, max_chars=PREVIOUS_TAIL_MAX_CHARS
        ),
    )


def render_book_context_block(context: BookContext) -> str | None:
    """把底座事实拼成 system 块；无任何可报事实时返回 None，调用方静默跳过。

    章节明细**刻意不进** prompt：模型有 fs_list，让它每轮背一份目录只会挤掉坐标。
    """

    sections: list[str] = ["[作品底座 · 确定性]\n" + _scale_line(context)]

    if context.skeleton:
        lines = [
            f"· {entry.relative_path}（{_format_chars(entry.estimated_chars)}）"
            for entry in context.skeleton
        ]
        if context.skeleton_total > MAX_SKELETON_FILES:
            lines.append(
                f"· …另有 {context.skeleton_total - MAX_SKELETON_FILES} 份，用 fs_list 看全。"
            )
        sections.append("[大纲 / 人物 / 设定索引 · 需要时用 fs_read 展开]\n" + "\n".join(lines))

    roster_lines = ["· " + _roster_display(entity) for entity in context.roster]
    if roster_lines and context.roster_declared_total > MAX_ROSTER_ENTITIES:
        roster_lines.append(
            f"· …另有 {context.roster_declared_total - MAX_ROSTER_ENTITIES} 位，见 canon.json。"
        )
    pointer = (
        "· 全书事实卡（每实体身份 / 别名 / 出场跨度 / 声明来源）："
        f"{DOSSIER_RELATIVE_PATH} —— fs_list 看不到它，但 fs_read 可以直接读这个路径。"
        if context.dossier_relative_path
        else None
    )
    if roster_lines or pointer:
        body = "\n".join([*roster_lines, *([pointer] if pointer else [])])
        sections.append("[已声明的人物 / 实体台账]\n" + body)

    if context.previous_chapter is not None:
        relative, tail = context.previous_chapter
        sections.append(f"[上一章结尾 · {relative}]\n{tail}")

    # 只有一个「0 章、没打开文件」的空壳时不值得占一个 system 位。
    if len(sections) == 1 and not context.chapters:
        return None
    return "\n\n".join(sections)


def to_payload(context: BookContext) -> dict[str, object]:
    """交给桌面端左栏的只读投影。字数一律是估算值，字段名带 estimated 提醒别当精确统计。"""

    return {
        "total_chapters": context.total_chapters,
        "total_estimated_chars": context.total_estimated_chars,
        "current_relative_path": context.current_relative_path,
        "current_ordinal": context.current_ordinal,
        "chapters": [
            {
                "ordinal": chapter.ordinal,
                "relative_path": chapter.relative_path,
                "estimated_chars": chapter.estimated_chars,
            }
            for chapter in context.chapters
        ],
        "skeleton": [
            {"relative_path": entry.relative_path, "estimated_chars": entry.estimated_chars}
            for entry in context.skeleton
        ],
        "skeleton_total": context.skeleton_total,
        "skeleton_limit": MAX_SKELETON_FILES,
        "roster": [
            {
                "canonical_name": entity.canonical_name,
                "aliases": entity.aliases,
                "first_chapter": entity.first_chapter,
                "last_chapter": entity.last_chapter,
                "missing": entity.missing,
            }
            for entity in context.roster
        ],
        "roster_declared_total": context.roster_declared_total,
        "roster_limit": MAX_ROSTER_ENTITIES,
        "dossier_relative_path": context.dossier_relative_path,
        "previous_chapter": (
            {
                "relative_path": context.previous_chapter[0],
                "tail": context.previous_chapter[1],
            }
            if context.previous_chapter is not None
            else None
        ),
        # 作者看见的必须就是模型看见的那一份，所以原文一并交付，不让前端另拼一遍。
        "prompt_block": render_book_context_block(context),
    }


def build_book_context_block(project_root: str, current_file: str | None) -> str | None:
    """确定性拼接「作品底座」system 块；无任何可报事实时返回 None，调用方静默跳过。"""

    context = build_book_context(project_root, current_file)
    if context is None:
        return None
    return render_book_context_block(context)


__all__ = [
    "BookContext",
    "ChapterEntry",
    "RosterEntity",
    "SkeletonFile",
    "build_book_context",
    "build_book_context_block",
    "render_book_context_block",
    "to_payload",
]
