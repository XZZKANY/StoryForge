"""Judge 域 Style Fingerprint 计算。

用少量可解释特征描述已批准章节的文风基线，用于生成前前馈对齐和评审时漂移检测。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.style_fingerprint import (  # noqa: F401  judge.service 把这几个当 facade 再导出
    STYLE_FINGERPRINT_DRIFT_PHRASES,
    STYLE_RESTRAINT_MARKERS,
    StyleFingerprint,
)
from app.common.style_fingerprint import marker_count as _marker_count  # noqa: F401
from app.common.style_fingerprint import split_sentences as _style_sentences
from app.common.style_fingerprint import style_fingerprint as _style_fingerprint
from app.domains.books.models import Chapter, Scene


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
