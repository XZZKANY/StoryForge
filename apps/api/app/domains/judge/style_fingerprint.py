"""Judge 域 Style Fingerprint 计算。

用少量可解释特征描述已批准章节的文风基线，用于生成前前馈对齐和评审时漂移检测。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.books.models import Chapter, Scene
from app.domains.judge.types import (
    STYLE_FINGERPRINT_DRIFT_PHRASES,
    STYLE_RESTRAINT_MARKERS,
    StyleFingerprint,
)


def compute_book_style_baseline(
    session: Session,
    book_id: int,
    *,
    chapter_window: int | None = None,
) -> dict[str, float | int] | None:
    """用作品下已批准章节正文算出 StyleFingerprint 基线，供生成前前馈对齐。

    无已批准章节时返回 None，交由调用方省略注入，绝不伪造空指纹。
    chapter_window 给定正整数时只取最近 N 个已批准章节，避免长程逐章全量重算。
    """

    rows = session.execute(
        select(Scene.content, Chapter.ordinal)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(
            Chapter.book_id == book_id,
            Chapter.status == "approved",
            Scene.content.is_not(None),
        )
        .order_by(Chapter.ordinal, Scene.ordinal, Scene.id)
    ).all()
    contents = [str(content).strip() for (content, _ordinal) in rows if str(content).strip()]
    if chapter_window is not None and chapter_window > 0:
        contents = contents[-chapter_window:]
    if not contents:
        return None
    return _style_fingerprint("\n".join(contents)).as_payload()


def _style_fingerprint(content: str) -> StyleFingerprint:
    """提取可解释的轻量文风特征，避免测试依赖外部 NLP 服务。"""

    sentences = _style_sentences(content)
    sentence_count = len(sentences)
    total_chars = sum(len(sentence) for sentence in sentences) or 1
    average_sentence_length = round(total_chars / max(sentence_count, 1), 3)
    exposition_density = round(_marker_count(content, STYLE_FINGERPRINT_DRIFT_PHRASES) / max(sentence_count, 1), 3)
    restraint_density = round(_marker_count(content, STYLE_RESTRAINT_MARKERS) / max(sentence_count, 1), 3)
    dialogue_ratio = round((content.count("「") + content.count("」")) / max(len(content), 1), 3)
    return StyleFingerprint(
        average_sentence_length=average_sentence_length,
        exposition_density=exposition_density,
        restraint_density=restraint_density,
        dialogue_ratio=dialogue_ratio,
        sentence_count=sentence_count,
    )


def _style_sentences(content: str) -> list[str]:
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


def _marker_count(content: str, markers: tuple[str, ...]) -> int:
    return sum(content.count(marker) for marker in markers)


def _style_similarity_score(baseline: StyleFingerprint, current: StyleFingerprint) -> float:
    """把当前文风与基线压缩为 0-1 分数，分数越低表示偏离越大。"""

    sentence_delta = _relative_delta(baseline.average_sentence_length, current.average_sentence_length)
    exposition_delta = min(abs(current.exposition_density - baseline.exposition_density), 1.0)
    restraint_delta = min(abs(current.restraint_density - baseline.restraint_density), 1.0)
    dialogue_delta = min(abs(current.dialogue_ratio - baseline.dialogue_ratio) * 8, 1.0)
    score = 1.0 - (0.35 * sentence_delta) - (0.35 * exposition_delta) - (0.2 * restraint_delta) - (0.1 * dialogue_delta)
    return round(max(0.0, min(1.0, score)), 3)


def _relative_delta(left: float, right: float) -> float:
    denominator = max(abs(left), abs(right), 1.0)
    return min(abs(left - right) / denominator, 1.0)


def _first_style_drift_phrase(content: str) -> str:
    for phrase in STYLE_FINGERPRINT_DRIFT_PHRASES:
        if phrase in content:
            return phrase
    sentences = _style_sentences(content)
    return sentences[0] if sentences else content[:1]


def _approved_style_sources(session: Session, scene_id: int) -> list[tuple[int, str]]:
    """读取同作品当前章节之前的已批准正文，作为 Style Guard 基线。"""

    current = session.execute(
        select(Chapter.book_id, Chapter.ordinal)
        .join(Scene, Scene.chapter_id == Chapter.id)
        .where(Scene.id == scene_id)
    ).first()
    if current is None:
        return []
    rows = session.execute(
        select(Scene.id, Scene.content)
        .join(Chapter, Scene.chapter_id == Chapter.id)
        .where(
            Chapter.book_id == int(current[0]),
            Chapter.ordinal < int(current[1]),
            Chapter.status == "approved",
            Scene.content.is_not(None),
            Scene.id != scene_id,
        )
        .order_by(Chapter.ordinal, Scene.ordinal, Scene.id)
    ).all()
    return [(int(scene_id), str(content).strip()) for scene_id, content in rows if str(content).strip()]
