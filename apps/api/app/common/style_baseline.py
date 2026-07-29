"""从作者本地正文量出文风基线，前馈成生成前的对齐目标。

`judge/style_fingerprint.py` 里那套「事后检出漂移 → 生成前对齐」的前馈早已建成，
但它锚在 `Chapter.status == "approved"` 与 `Scene.content` 上——那是 BookRun 的 DB 实体，
桌面产品从不创建。于是学习闭环整个搁浅在退役的批量管线后面。本模块把同一组特征改从
本地手稿文件算出来，让它在桌面路径上复活。

**为什么带置信区间，而不是算个平均数就喂**：两章语料算出的「平均 24.3 字/句」是噪声
穿了测量的外衣。作者的句长本来就逐章起伏，样本少时章间方差会把均值推得到处跑，
而模型会把喂进去的数字当硬目标照做——等于用随机数去规训作者自己的文风。所以这里
不设「够几章就开」的拍脑袋阈值，而是**量出这个数有多准**：按文件切块算块间标准误，
95% 置信区间半宽超过容差的维度直接不注入。样本说不准的事，就不说。

与 craft / author_voice 同规矩：无 domains 依赖叶子。语料枚举沿用 canon 侧同一套约定
（非 dot 目录下的正文 `*.md`、路径序即阅读序，见 `agent_runs/canon_rebuild.py`），但因
common 不得 import domains，此处自持一份最小遍历——「哪些算正文」这一判据已下沉
`app/common/manuscript.py`，两侧共用，不会再各判各的。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

from app.common.manuscript import iter_manuscript_files
from app.common.style_fingerprint import split_sentences, style_fingerprint

# 只取最近若干个正文文件：文风还在成形时，近作比首章更能代表「现在的作者」，
# 顺带给每次生成的读盘量封顶。
RECENT_FILES = 10
MIN_CHUNK_CHARS = 400
MIN_CHUNKS = 3
MAX_FILE_BYTES = 200_000
MAX_TOTAL_BYTES = 800_000

# 容差：95% 置信区间半宽超过它，该维度就不够格当目标说出口。
# 句长 ±2 字——说「约 24 字/句」而实际可能是 21 或 27，这个目标没有意义。
# 对白标记占比 ±0.01——典型区间约 0.02-0.08，再宽就分不出「对白多」和「对白少」。
AVG_SENTENCE_LENGTH_TOLERANCE = 2.0
DIALOGUE_RATIO_TOLERANCE = 0.01

# t 分布 97.5% 分位（双侧 95%），df=1..20；df>20 用 2.086 之后收敛到 1.96。
# 硬编码小表以免为一个数引入 scipy。
_T_CRITICAL = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
    11: 2.201,
    12: 2.179,
    13: 2.160,
    14: 2.145,
    15: 2.131,
    16: 2.120,
    17: 2.110,
    18: 2.101,
    19: 2.093,
    20: 2.086,
}


@dataclass(frozen=True)
class StyleTarget:
    """一个量出来的目标值，连同它的不确定度一起带着。"""

    value: float
    half_width: float


@dataclass(frozen=True)
class StyleBaseline:
    """本地正文量出的文风基线。任一目标为 None 表示样本不足以确定该维度。"""

    file_count: int
    sentence_count: int
    average_sentence_length: StyleTarget | None
    dialogue_ratio: StyleTarget | None

    @property
    def has_target(self) -> bool:
        return self.average_sentence_length is not None or self.dialogue_ratio is not None


def _iter_manuscript_files(root: Path) -> list[Path]:
    """非 dot 目录下的正文 `*.md`，按路径序（= 阅读序）返回。

    必须排非正文目录：大纲与人物设定是条目式文本，没有对白也几乎没有完整句，混进语料会把
    对白密度压低、句长测偏——而这套数字是要写进产字 prompt 当"作者文风"的。
    """

    return iter_manuscript_files(root)


def _read_chunk(path: Path) -> str | None:
    try:
        raw = path.read_bytes()[:MAX_FILE_BYTES]
    except OSError:
        return None
    if b"\x00" in raw[:1024]:
        return None
    text = raw.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n").strip()
    return text if len(text) >= MIN_CHUNK_CHARS else None


def _mean_with_ci(values: list[float]) -> StyleTarget | None:
    """块间均值 + 95% 置信区间半宽；块数不足以估方差时返回 None。"""

    count = len(values)
    if count < MIN_CHUNKS:
        return None
    mean = sum(values) / count
    variance = sum((value - mean) ** 2 for value in values) / (count - 1)
    standard_error = math.sqrt(variance) / math.sqrt(count)
    critical = _T_CRITICAL.get(count - 1, 1.96)
    return StyleTarget(value=mean, half_width=critical * standard_error)


def build_style_baseline(project_path: str | None) -> StyleBaseline | None:
    """扫本地正文算文风基线；语料不足或全维度不够准时返回 None（调用方据此不注入）。

    每次调用重扫，不缓存——与作者指令同规矩，作者写完一章立刻算进基线。
    任何异常都吞掉返回 None：这是加分项，绝不能拖垮生成。
    """

    if not isinstance(project_path, str) or not project_path.strip():
        return None
    try:
        root = Path(project_path).resolve()
        if not root.is_dir():
            return None
        candidates = _iter_manuscript_files(root)[-RECENT_FILES:]
    except OSError:
        return None

    chunks: list[str] = []
    total_bytes = 0
    for path in candidates:
        text = _read_chunk(path)
        if text is None:
            continue
        total_bytes += len(text)
        if total_bytes > MAX_TOTAL_BYTES:
            break
        chunks.append(text)

    if len(chunks) < MIN_CHUNKS:
        return None

    fingerprints = [style_fingerprint(chunk) for chunk in chunks]
    sentence_count = sum(len(split_sentences(chunk)) for chunk in chunks)

    average_sentence_length = _mean_with_ci([item.average_sentence_length for item in fingerprints])
    if average_sentence_length is not None and average_sentence_length.half_width > AVG_SENTENCE_LENGTH_TOLERANCE:
        average_sentence_length = None

    dialogue_ratio = _mean_with_ci([item.dialogue_ratio for item in fingerprints])
    if dialogue_ratio is not None and dialogue_ratio.half_width > DIALOGUE_RATIO_TOLERANCE:
        dialogue_ratio = None
    # 测得 0 不等于「这位作者不写对白」：dialogue_ratio 只数「」，弯引号“”是刻意排除的
    # （judge 侧已记为决定，见 test_judge_style_guard）。用“”的手稿会稳稳测出 0.00 且半宽为 0，
    # 照喂就是命令生成器别写对白。零对白一律当口径不匹配处理，闭嘴。
    if dialogue_ratio is not None and dialogue_ratio.value <= 0:
        dialogue_ratio = None

    baseline = StyleBaseline(
        file_count=len(chunks),
        sentence_count=sentence_count,
        average_sentence_length=average_sentence_length,
        dialogue_ratio=dialogue_ratio,
    )
    return baseline if baseline.has_target else None


def style_baseline_clause(baseline: StyleBaseline) -> str:
    """把基线压成一句可拼进 system prompt 的中文子句。

    措辞是**对齐目标**而非硬规则：这是量出来的统计量，不是作者的主张。作者写进
    `agent-instructions.md` 的显式要求与之冲突时，以作者的为准（注入顺序保证这一点）。
    """

    parts: list[str] = []
    if baseline.average_sentence_length is not None:
        parts.append(
            f"目标句长：平均约 {baseline.average_sentence_length.value:.0f} 字/句，"
            "贴合你已写章节的节奏，避免明显变长或变碎"
        )
    if baseline.dialogue_ratio is not None:
        parts.append(
            f"目标对白密度：与已写章节相当（参考标记占比 {baseline.dialogue_ratio.value:.2f}），"
            "不要突然大段独白或全是旁白"
        )
    return (
        "文风基线（量自作者已写的正文，是对齐目标不是硬规则，与作者显式要求冲突时以作者为准；"
        f"样本：{baseline.file_count} 个正文文件、{baseline.sentence_count} 句）："
        + "；".join(parts)
        + "。样本不足以确定的维度已略去，不要就此臆测。"
    )


def append_style_baseline_to_system_prompt(system_prompt: str, project_path: str | None) -> str:
    """把文风基线接到 system prompt 末尾；量不出来就原样返回。"""

    baseline = build_style_baseline(project_path)
    if baseline is None:
        return system_prompt
    return system_prompt + "\n\n" + style_baseline_clause(baseline)
