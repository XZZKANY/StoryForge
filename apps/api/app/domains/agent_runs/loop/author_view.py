"""作者当前视图：把「作者此刻正看着哪一段」解码成可注入循环的文本块。

为什么需要这一层：此前每轮只注入文件路径，不注入内容。代码 agent 可以让模型 grep
标识符把上下文找回来，散文不行——作者的指代是「这一段」「我刚写的这句」，靠 fs_search
捞是错工具。前端本来就在发选区与光标，后端此前全丢。

纯函数、无 IO：窗口内容取自前端已发的 content，不额外读盘（也就不会与作者未保存的
编辑打架——前端发的正是编辑器缓冲里的当前值）。

typed 契约而非裸 dict：`run_chat_loop` 体内禁止裸 `.get()`（源码标准硬门禁），
业务 payload 必须在进循环前解码完毕。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

# 选区注入上限：作者整章全选时不把整章当「这一段」灌进每一轮。
SELECTION_MAX_CHARS = 4_000
# 无选区时光标前后各取的字数。前多后少：续写与改稿都更依赖上文语感。
CURSOR_BEFORE_CHARS = 1_500
CURSOR_AFTER_CHARS = 600
# @ 钉上下文摘录上限（bundle 已在前端逐文件截断，这里只兜总量）。
PINNED_CONTEXT_MAX_CHARS = 6_000


@dataclass(frozen=True)
class AuthorView:
    """作者此刻的编辑器视图。所有字段都可能缺失——作者没开文件时循环照跑。"""

    file_path: str | None = None
    cursor_line: int = 0
    cursor_column: int = 0
    selection_text: str = ""
    content: str = ""

    @classmethod
    def from_payload(cls, args: Mapping[str, object]) -> AuthorView:
        raw = args.get("author_view")
        view = raw if isinstance(raw, Mapping) else {}
        content = args.get("content")
        selection = view.get("selection_text")
        return cls(
            file_path=_text(view.get("file_path")) or _text(args.get("file_path")),
            cursor_line=_non_negative_int(view.get("cursor_line")),
            cursor_column=_non_negative_int(view.get("cursor_column")),
            selection_text=(selection[:SELECTION_MAX_CHARS] if isinstance(selection, str) else ""),
            content=content if isinstance(content, str) else "",
        )

    @property
    def has_view(self) -> bool:
        return bool(self.selection_text.strip() or (self.content.strip() and self.cursor_line > 0))


def cursor_window(
    content: str,
    cursor_line: int,
    *,
    before_chars: int = CURSOR_BEFORE_CHARS,
    after_chars: int = CURSOR_AFTER_CHARS,
) -> tuple[str, str]:
    """取光标行前后两段窗口，返回 (上文, 下文)。

    cursor_line 是 1-based 且含在上文里（作者刚敲完的那行属于「已写的」）。越界一律夹到
    合法区间——前端行号与后端拿到的内容可能差一次未保存编辑，宁可少取一行也不要抛错
    打断作者（同 assistant/continuation.manuscript_tail 的立场）。
    """

    if not content:
        return "", ""
    lines = content.split("\n")
    end = max(0, min(cursor_line, len(lines)))
    head = "\n".join(lines[:end])
    tail = "\n".join(lines[end:])
    if len(head) > before_chars:
        head = head[-before_chars:]
        # 从段落边界起头，避免上文以半句开始误导模型对语感的判断。
        boundary = head.find("\n\n")
        if boundary != -1 and boundary < before_chars // 2:
            head = head[boundary + 2 :]
    if len(tail) > after_chars:
        tail = tail[:after_chars]
        boundary = tail.rfind("\n\n")
        if boundary != -1 and boundary > after_chars // 2:
            tail = tail[:boundary]
    return head.strip("\n"), tail.strip("\n")


def build_author_view_block(view: AuthorView) -> str | None:
    """把作者视图拼成一段 system 文本。选区优先——作者主动选中即最强的指代信号。"""

    if not view.has_view:
        return None
    location = f"作者正在编辑：{view.file_path}" if view.file_path else "作者正在编辑当前稿件"
    if view.selection_text.strip():
        return (
            f"{location}\n作者当前**选中**了下面这段（作者说「这一段」「这几句」时指的就是它）：\n"
            f"<<<SELECTION\n{view.selection_text.strip()}\nSELECTION>>>"
        )
    head, tail = cursor_window(view.content, view.cursor_line)
    if not head and not tail:
        return None
    blocks = [f"{location}，光标停在第 {view.cursor_line} 行。作者说「这里」「刚写的」时指的是光标附近。"]
    if head:
        blocks.append("光标之前（含光标行）：\n<<<BEFORE_CURSOR\n" + head + "\nBEFORE_CURSOR>>>")
    if tail:
        blocks.append("光标之后：\n<<<AFTER_CURSOR\n" + tail + "\nAFTER_CURSOR>>>")
    blocks.append("这是节选窗口，不是全文；需要更多正文用 fs_read。")
    return "\n\n".join(blocks)


def build_pinned_context_block(context_block: str | None) -> str | None:
    """作者 @ 钉的文件摘录。此前只有回落单轮对话在用，循环路径静默丢弃。"""

    if not context_block or not context_block.strip():
        return None
    excerpt = context_block.strip()[:PINNED_CONTEXT_MAX_CHARS]
    return "作者为这轮对话指定了以下上下文文件摘录：\n\n" + excerpt


def author_view_summary(view: AuthorView) -> dict[str, object]:
    """落事件表的摘要：只记形状与量，正文不进事件表。"""

    return {
        "file_path": view.file_path,
        "cursor_line": view.cursor_line,
        "selection_chars": len(view.selection_text),
        "content_chars": len(view.content),
    }


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _non_negative_int(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return value if value > 0 else 0
