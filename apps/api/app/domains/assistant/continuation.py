"""光标处续写的纯函数层：上文取窗、prompt 组装、生成后确定性后处理。

设计取自三条公开工艺（均非 copyleft 来源）：

1. **操舵指令贴近尾部**。长文续写工具把"作者旁注"注入在距离结尾固定深度处而非顶部，
   因为近因位置对下一段的影响远大于开头。故本模块把 canon 硬约束与本次要求排在上文
   之后、prompt 最末，而不是塞进 system。
2. **显式禁止收尾**。分段长文生成的头号病是每一段都想给你写一个总结或悬念钩子式收束
   （AgentWrite/LongWriter, Apache-2.0 的 write 模板明确写了这条）。
3. **防重复靠 prompt + 确定性后处理，不靠采样惩罚**。作者常用的兼容端点已移除
   frequency/presence penalty（传了也不生效），且有生产复盘实测调参对重复"零到负效果"。
   故重复由 `strip_repeated_prefix` 在文本层掐掉。
"""

from __future__ import annotations

from app.common.craft import craft_prompt_clause

# 上文取窗上限：够模型接住语感与当前场景，又不至于把整章塞进每一次续写。
TAIL_MAX_CHARS = 3000
# 一段的目标区间；作者选定"一段"为默认粒度（生成快、好判断、不合意重来不心疼）。
DEFAULT_TARGET_CHARS = 300

CONTINUE_SYSTEM_PROMPT = (
    "你是 StoryForge 的中文长篇小说作者，正在作者本人的稿件上接着往下写。"
    "你写出的文字会直接插进作者的正文里，因此必须与上文保持同一叙事人称、同一语感、"
    "同一场景时空，读起来像同一个人一口气写下来的。"
    + craft_prompt_clause()
    + "只输出续写的正文本身，不要输出解释、标题、前后缀或代码块标记。"
)

_SENTENCE_ENDINGS = "。！？…”』」》!?"


def manuscript_tail(content: str, cursor_line: int, *, max_chars: int = TAIL_MAX_CHARS) -> str:
    """取光标行（含）之前的正文尾巴，按段落边界截断到 max_chars 以内。

    cursor_line 是 1-based；越界一律夹到合法区间，因为前端行号与后端读到的文件可能
    差一次未保存的编辑，宁可少取一行也不要抛错打断作者。
    """

    if not content:
        return ""
    lines = content.split("\n")
    end = max(0, min(cursor_line, len(lines)))
    head = "\n".join(lines[:end])
    if len(head) <= max_chars:
        return head.strip("\n")
    window = head[-max_chars:]
    # 从段落边界起头，避免上文以半句开始误导模型的语感判断。
    boundary = window.find("\n\n")
    if boundary != -1 and boundary < max_chars // 2:
        window = window[boundary + 2 :]
    return window.strip("\n")


def build_continue_prompt(
    *,
    tail: str,
    file_path: str,
    instruction: str | None = None,
    scene_constraints: str | None = None,
    target_chars: int = DEFAULT_TARGET_CHARS,
) -> str:
    """组续写 user prompt：定位 → 上文 → canon 约束 → 本次要求（最末，近因最强）。"""

    blocks: list[str] = [f"文件：{file_path}"]
    if tail:
        blocks.append("以下是这份稿件到光标为止的上文：\n<<<MANUSCRIPT\n" + tail + "\nMANUSCRIPT>>>")
    else:
        blocks.append("这份稿件当前还是空的，你要写的是开头。")
    if scene_constraints:
        blocks.append(scene_constraints)

    requirements = [
        "从上文的最后一个字接着往下写，不要重复、不要重述、不要总结上文已有的内容。",
        f"这一次只写约 {target_chars} 个中文字符（一个自然段到一个小节拍），不要写完整章。",
        "这是进行中的作品：不要收尾，不要写总结性结语，也不要刻意甩悬念钩子式的收束句。",
        "不要另起标题或分隔线，直接写正文。",
    ]
    if instruction:
        requirements.append(f"作者对这一段的额外要求：{instruction}")
    blocks.append("【本次续写要求】\n" + "\n".join(f"- {item}" for item in requirements))
    return "\n\n".join(blocks)


def strip_repeated_prefix(tail: str, generated: str, *, min_overlap: int = 8) -> str:
    """掐掉模型在续写开头重抄的那截上文。

    最常见的形状是把上文最后一两句原样复述一遍再往下写。取 tail 的最长后缀去匹配
    generated 的前缀；min_overlap 挡住"他"、"于是"这类短串造成的误伤。
    """

    if not tail or not generated:
        return generated
    normalized_tail = tail.rstrip()
    limit = min(len(normalized_tail), len(generated), 400)
    for size in range(limit, min_overlap - 1, -1):
        if generated.startswith(normalized_tail[-size:]):
            return generated[size:].lstrip()
    return generated


def trim_to_sentence_end(text: str, *, min_keep_ratio: float = 0.5) -> str:
    """把因 token 上限截断的半句裁到最后一个完整句末。

    砍掉的部分超过一半时放弃裁剪：宁可留一个半句让作者自己收，也不要把刚生成的大部分丢掉。
    """

    stripped = text.rstrip()
    if not stripped:
        return ""
    if stripped[-1] in _SENTENCE_ENDINGS:
        return stripped
    cut = max((stripped.rfind(char) for char in _SENTENCE_ENDINGS), default=-1)
    if cut < 0 or (cut + 1) < len(stripped) * min_keep_ratio:
        return stripped
    return stripped[: cut + 1]


def finalize_continuation(tail: str, generated: str) -> str:
    """生成后的确定性收口：先掐重复开头，再裁到完整句末。"""

    return trim_to_sentence_end(strip_repeated_prefix(tail, generated.strip()))


def resolve_anchor_line(content: str, cursor_line: int) -> int:
    """从光标行推导落点：往上跳过连续空行，让新段紧贴上一段而不是掉进一片空白里。

    作者写完一段习惯连敲两下回车再停手，此时光标在第二个空行上。若原样把落点定在
    光标行，续写会与上文之间隔出多余空行。与前端 lib/inline-continue.ts 的
    resolveContinueAnchorLine 同语义（两侧各自实现，行为由测试对齐）。

    返回 1-based：在此行之后插入；0 = 文件顶部。
    """

    lines = content.replace("\r\n", "\n").split("\n")
    anchor = max(0, min(int(cursor_line), len(lines)))
    while anchor > 0 and not lines[anchor - 1].strip():
        anchor -= 1
    return anchor


def insert_at_anchor(content: str, anchor_line: int, text: str) -> str:
    """在 anchor_line 之后插入续写段，前后各留一个空行（段落边界）。

    纯函数：不判断 text 是否为空，调用方负责（空续写在上游已按失败处理）。
    """

    normalized = content.replace("\r\n", "\n")
    lines = normalized.split("\n")
    anchor = max(0, min(int(anchor_line), len(lines)))
    head = lines[:anchor]
    tail = lines[anchor:]
    block = text.strip("\n")
    merged = [*head, "", block] if head else [block]
    # 落点后原本就有正文时补一个空行，避免新段与下文黏成一段。
    if any(line.strip() for line in tail):
        merged.append("")
    return "\n".join([*merged, *tail])
