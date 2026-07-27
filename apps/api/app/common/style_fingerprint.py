"""文风指纹的纯计算：单一事实源，检查器与生成器共用同一套数学。

原实现在 `domains/judge/style_fingerprint.py`，只服务 BookRun 的事后漂移检出。
桌面产字路径要把同一组特征**前馈**成生成前的对齐目标（见 `style_baseline.py`），
若在 common 另写一份切句与计数，检查器与生成器就会各按各的尺子说话——那正是
`craft.py` 下沉时要根除的病。故把纯函数下沉到此，judge 侧改吃本模块并保留别名。

与 craft / author_voice 同规矩：无 domains 依赖叶子，不 import 任何 domains。
"""

from __future__ import annotations

from dataclasses import dataclass

# 确定性文风漂移检测短语（原 judge.types，随纯函数一并下沉；judge 侧别名再导出）
STYLE_DRIFT_PHRASES = ("作者直接解释", "设定说明", "旁白解释", "直接说明设定", "作者在这里解释")
STYLE_FINGERPRINT_DRIFT_PHRASES = (
    *STYLE_DRIFT_PHRASES,
    "这说明",
    "意味着",
    "读者立刻明白",
    "宏大轮盘",
)
STYLE_RESTRAINT_MARKERS = ("克制", "沉默", "低声", "按住", "没有解释", "只把")


@dataclass(frozen=True)
class StyleFingerprint:
    """用少量可解释特征描述已批准章节的文风基线。"""

    average_sentence_length: float
    exposition_density: float
    restraint_density: float
    dialogue_ratio: float
    sentence_count: int

    def as_payload(self) -> dict[str, float | int]:
        return {
            "average_sentence_length": self.average_sentence_length,
            "exposition_density": self.exposition_density,
            "restraint_density": self.restraint_density,
            "dialogue_ratio": self.dialogue_ratio,
            "sentence_count": self.sentence_count,
        }


def style_fingerprint(content: str) -> StyleFingerprint:
    """提取可解释的轻量文风特征，避免测试依赖外部 NLP 服务。"""

    sentences = split_sentences(content)
    sentence_count = len(sentences)
    total_chars = sum(len(sentence) for sentence in sentences) or 1
    average_sentence_length = round(total_chars / max(sentence_count, 1), 3)
    exposition_density = round(marker_count(content, STYLE_FINGERPRINT_DRIFT_PHRASES) / max(sentence_count, 1), 3)
    restraint_density = round(marker_count(content, STYLE_RESTRAINT_MARKERS) / max(sentence_count, 1), 3)
    dialogue_ratio = round((content.count("「") + content.count("」")) / max(len(content), 1), 3)
    return StyleFingerprint(
        average_sentence_length=average_sentence_length,
        exposition_density=exposition_density,
        restraint_density=restraint_density,
        dialogue_ratio=dialogue_ratio,
        sentence_count=sentence_count,
    )


def split_sentences(content: str) -> list[str]:
    separators = "。！？!?\n\r"
    sentences: list[str] = []
    start = 0
    for index, char in enumerate(content):
        if char not in separators:
            continue
        sentence = content[start:index].strip()
        if sentence:
            sentences.append(sentence)
        start = index + 1
    tail = content[start:].strip()
    if tail:
        sentences.append(tail)
    return sentences or [content.strip()] if content.strip() else []


def marker_count(content: str, markers: tuple[str, ...]) -> int:
    return sum(content.count(marker) for marker in markers)
