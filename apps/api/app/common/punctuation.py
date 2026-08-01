"""还原模型「顺手美化」掉的标点，让 diff 只剩作者真正要看的改动。

放 common 的理由：两条修订链（agent loop 的 `file.revise`、Ctrl+K 走的
`/api/assistant/revise`）在 LLM 层汇合于 `assistant.service.revise_file_content`，
这里是它们唯一的共同上游，且必须早于 `revise_scope.scope_warning` 的行级漂移判定。

为什么需要确定性闸：三处 prompt（`revise_scope.py`、`inline-chat.ts`、
`assistant/service.py`）都写了「不得调整标点」，但提示词管不住——模型仍会把
中文引号换成直引号、把 `……` 写成 `...`。这类漂移不会让写回失败，而是
①直接把全篇标点改掉写进正文；②把 `_revise_drift_ratio` 顶到 97%，让越界警告
沦为噪音（实测：零真实改动的纯标点漂移 = 737/758 行判为「已改动」）。
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

# 只折叠「同一个标点的不同 Unicode 形态」。刻意不收中英文标点互换（，↔, 。↔.）：
# 那在中文正文里是该被作者看见的质量问题，不是无害的排版漂移。
_PUNCTUATION_FOLDS = {
    "“": '"',  # “
    "”": '"',  # ”
    "„": '"',  # „
    "‟": '"',  # ‟
    "‘": "'",  # ‘
    "’": "'",  # ’
    "‚": "'",  # ‚
    "‛": "'",  # ‛
    "‐": "-",  # ‐
    "‑": "-",  # ‑
    "‒": "-",  # ‒
    "–": "-",  # –
    "—": "-",  # — （中文破折号 —— 是两个）
    "―": "-",  # ―
    "…": ".",  # …
    " ": " ",  # 不换行空格
    "　": " ",  # 全角空格（段首缩进常用）
    " ": " ",  # 数字空格
    " ": " ",  # 窄不换行空格
}

_FOLD_TABLE = str.maketrans(_PUNCTUATION_FOLDS)

# 逐字符折叠不够：中文省略号和破折号成对出现（…… / ——），而模型常写成长度不同的
# ASCII（... / -- / -）。把折叠后连续重复的 . - 空格 归并成一个，这三种写法才等价。
# 代价：markdown 分隔线 --- 与 - 也会等价，方向是保留作者原样，可接受。
_REPEAT_RUN = re.compile(r"([.\- ])\1+")


def canonical_punctuation(text: str) -> str:
    """把易漂移的标点折叠到规范形，仅用于比较，不作为写回内容。"""

    return _REPEAT_RUN.sub(r"\1", text.translate(_FOLD_TABLE))


def restore_incidental_punctuation(before: str, after: str) -> str:
    """把 after 里「只有标点形态变了」的行还原成 before 的原样，真实改动一字不动。

    对齐方式是在**折叠后**的行序列上求 diff：`equal` 块意味着这些行至多只有标点
    差异，于是整块取 before 原文（还原）；其余块是真实改动，整块取 after 原文
    （连同模型在那几行用的标点一并保留——那是它这次改动的一部分）。

    一个例外：若 before 与 after 折叠后**完全相同**（即这次修订除标点外什么都没改），
    则原样返回 after。此时"只改标点"多半正是作者要的（例如「把直引号统一成中文引号」），
    这道闸不该把它撤销。

    粒度是「行」：某一行既有真实改动又有标点漂移时，整行取 after（漂移随改动一起
    呈现在 diff 里，作者看得见）。这道闸保护的是未点名的行——「改一段却全篇标点被换」
    正是问题的主体。
    """

    if before == after:
        return after

    before_lines = before.split("\n")
    after_lines = after.split("\n")
    matcher = SequenceMatcher(
        None,
        [canonical_punctuation(line) for line in before_lines],
        [canonical_punctuation(line) for line in after_lines],
        # 中文正文里空行极多，autojunk 会把它们当"常见元素"剔除而错位对齐。
        autojunk=False,
    )
    opcodes = matcher.get_opcodes()
    if all(tag == "equal" for tag, *_ in opcodes):
        return after

    restored: list[str] = []
    for tag, before_start, before_end, after_start, after_end in opcodes:
        if tag == "equal":
            restored.extend(before_lines[before_start:before_end])
        else:
            restored.extend(after_lines[after_start:after_end])
    return "\n".join(restored)
