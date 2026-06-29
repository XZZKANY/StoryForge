"""Judge 域跨域一致性检测。

Character Bible、Timeline、Style Fingerprint Drift 等跨域一致性规则检测。
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domains.books.models import Chapter, Scene
from app.domains.character_bible.models import CharacterBibleEntry
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.style_fingerprint import (
    _approved_style_sources,
    _first_style_drift_phrase,
    _style_fingerprint,
    _style_similarity_score,
)
from app.domains.judge.types import (
    STYLE_FINGERPRINT_THRESHOLD,
    DetectedIssue,
)
from app.domains.story_memory.models import MemoryAtomRecord


def _detect_character_bible_violations(session: Session, payload: JudgeIssueCreate) -> list[DetectedIssue]:
    """按 Character Bible 禁止特质生成角色一致性问题单。"""

    book_id = _book_id_for_scene(session, payload.scene_id)
    if book_id is None:
        return []
    entries = session.scalars(
        select(CharacterBibleEntry)
        .where(CharacterBibleEntry.book_id == book_id)
        .order_by(CharacterBibleEntry.canonical_name, CharacterBibleEntry.id)
    ).all()
    issues: list[DetectedIssue] = []
    for entry in entries:
        replacement_map = _forbidden_replacement_map(entry.forbidden_traits)
        for forbidden_trait in _forbidden_trait_phrases(entry.forbidden_traits):
            if forbidden_trait not in payload.content:
                continue
            start = payload.content.index(forbidden_trait)
            replacement = replacement_map.get(forbidden_trait, f"避免{forbidden_trait}")
            issues.append(
                DetectedIssue(
                    category="character_consistency",
                    severity="high",
                    span_start=start,
                    span_end=start + len(forbidden_trait),
                    summary=f"正文违反角色“{entry.canonical_name}”的禁止特质“{forbidden_trait}”。",
                    recommended_repair_mode="replace_span",
                    expected_text=f"不得呈现：{forbidden_trait}",
                    replacement_text=replacement,
                    matched_text=forbidden_trait,
                    metadata={
                        "consistency_dimensions": {
                            "character_consistency": "fail",
                            "world_consistency": "pass",
                        },
                        "violation": {
                            "type": "forbidden_trait",
                            "canonical_name": entry.canonical_name,
                            "forbidden_trait": forbidden_trait,
                            "replacement_text": replacement,
                        },
                        "forbidden_trait": forbidden_trait,
                        "character_bible_entry_id": entry.id,
                    },
                )
            )
    return issues


def _load_voice_constraints(session: Session, scene_id: int) -> list[dict]:
    """读取作品下的角色声音约束，仅保留声明了 voice_traits 的条目。"""

    book_id = _book_id_for_scene(session, scene_id)
    if book_id is None:
        return []
    entries = session.scalars(
        select(CharacterBibleEntry)
        .where(CharacterBibleEntry.book_id == book_id)
        .order_by(CharacterBibleEntry.canonical_name, CharacterBibleEntry.id)
    ).all()
    return [
        {"name": entry.canonical_name, "voice_traits": entry.voice_traits}
        for entry in entries
        if entry.voice_traits
    ]


def _detect_timeline_conflicts(session: Session, payload: JudgeIssueCreate) -> list[DetectedIssue]:
    """基于当前有效 Story Memory 检测最小时间线矛盾。"""

    scope = _scene_scope_for_judge(session, payload.scene_id)
    if scope is None:
        return []
    book_id, chapter_ordinal = scope
    records = session.scalars(
        select(MemoryAtomRecord)
        .where(
            MemoryAtomRecord.book_id == book_id,
            MemoryAtomRecord.entity_type == "character",
            MemoryAtomRecord.fact_type.in_(("status", "location")),
            MemoryAtomRecord.valid_from_chapter <= chapter_ordinal,
            (MemoryAtomRecord.valid_to_chapter.is_(None) | (MemoryAtomRecord.valid_to_chapter >= chapter_ordinal)),
        )
        .order_by(MemoryAtomRecord.entity_id, MemoryAtomRecord.fact_type, MemoryAtomRecord.id)
    ).all()
    issues: list[DetectedIssue] = []
    for record in records:
        if record.fact_type == "status":
            death_issue = _dead_character_issue(payload.content, record)
            if death_issue is not None:
                issues.append(death_issue)
        if record.fact_type == "location":
            location_issue = _same_time_location_issue(payload.content, record)
            if location_issue is not None:
                issues.append(location_issue)
    return issues


def _detect_style_fingerprint_drift(session: Session, payload: JudgeIssueCreate) -> list[DetectedIssue]:
    """用已批准章节正文建立文风基线，并对后续章节明显偏离扣分。"""

    sources = _approved_style_sources(session, payload.scene_id)
    if not sources:
        return []
    source_scene_ids = [scene_id for scene_id, _content in sources]
    baseline_text = "\n".join(content for _scene_id, content in sources)
    baseline = _style_fingerprint(baseline_text)
    current = _style_fingerprint(payload.content)
    style_score = _style_similarity_score(baseline, current)
    if style_score >= STYLE_FINGERPRINT_THRESHOLD:
        return []
    matched_text = _first_style_drift_phrase(payload.content)
    span_start = payload.content.index(matched_text) if matched_text in payload.content else 0
    span_end = span_start + len(matched_text)
    return [
        DetectedIssue(
            category="style_drift",
            severity="medium",
            span_start=span_start,
            span_end=span_end,
            summary=f"正文文风与已批准章节指纹偏离，style_score={style_score:.2f} 低于阈值。",
            recommended_repair_mode="replace_span",
            expected_text="延续已批准章节的文风指纹",
            replacement_text="延续已批准章节的克制描写",
            matched_text=matched_text,
            metadata={
                "style_dimension": "fingerprint_drift",
                "style_score": style_score,
                "style_baseline_score": 1.0,
                "style_threshold": STYLE_FINGERPRINT_THRESHOLD,
                "style_fingerprint": {
                    "baseline": baseline.as_payload(),
                    "current": current.as_payload(),
                    "source_scene_ids": source_scene_ids,
                },
                "violation": {
                    "type": "style_fingerprint_drift",
                    "source_scene_ids": source_scene_ids,
                },
            },
        )
    ]


def _book_id_for_scene(session: Session, scene_id: int) -> int | None:
    """通过场景找到作品 id，避免 Judge 请求重复传 book_id。"""

    scope = _scene_scope_for_judge(session, scene_id)
    return scope[0] if scope is not None else None


def _scene_scope_for_judge(session: Session, scene_id: int) -> tuple[int, int] | None:
    """返回 Judge 所需的作品 id 和章节序号。"""

    row = session.execute(
        select(Chapter.book_id)
        .add_columns(Chapter.ordinal)
        .join(Scene, Scene.chapter_id == Chapter.id)
        .where(Scene.id == scene_id)
    ).first()
    if row is None:
        return None
    return int(row[0]), int(row[1])


def _dead_character_issue(content: str, record: MemoryAtomRecord) -> DetectedIssue | None:
    """角色已死亡但正文仍让其出场时生成时间线冲突。"""

    if record.entity_id not in content or not _contains_death_state(record.value):
        return None
    start = content.index(record.entity_id)
    return DetectedIssue(
        category="timeline_conflict",
        severity="high",
        span_start=start,
        span_end=start + len(record.entity_id),
        summary=f"角色“{record.entity_id}”已死亡，不能在当前章节继续出场。",
        recommended_repair_mode="replace_span",
        expected_text=record.value,
        replacement_text=f"删除{record.entity_id}的出场",
        matched_text=record.entity_id,
        metadata={
            "violation": {
                "type": "dead_character_appears",
                "entity_id": record.entity_id,
            },
            "timeline_fact": _timeline_fact_payload(record),
        },
    )


def _same_time_location_issue(content: str, record: MemoryAtomRecord) -> DetectedIssue | None:
    """同一时间角色出现在不同地点时生成时间线冲突。"""

    if record.entity_id not in content:
        return None
    expected = _parse_timeline_location(record.value)
    if expected is None:
        return None
    time_marker, expected_location = expected
    if time_marker not in content:
        return None
    observed_location = _observed_location_after_character(content, record.entity_id)
    if observed_location is None or observed_location == expected_location:
        return None
    start = content.index(observed_location)
    return DetectedIssue(
        category="timeline_conflict",
        severity="high",
        span_start=start,
        span_end=start + len(observed_location),
        summary=f"角色“{record.entity_id}”在“{time_marker}”应位于“{expected_location}”，不能同时出现在“{observed_location}”。",
        recommended_repair_mode="replace_span",
        expected_text=expected_location,
        replacement_text=expected_location,
        matched_text=observed_location,
        metadata={
            "violation": {
                "type": "same_time_different_location",
                "entity_id": record.entity_id,
                "time": time_marker,
                "expected_location": expected_location,
                "observed_location": observed_location,
            },
            "timeline_fact": _timeline_fact_payload(record),
        },
    )


def _contains_death_state(value: str) -> bool:
    return any(marker in value for marker in ("已死亡", "死亡", "身亡", "去世", "死去"))


def _timeline_fact_payload(record: MemoryAtomRecord) -> dict[str, object]:
    return {
        "memory_atom_id": record.id,
        "fact_type": record.fact_type,
        "value": record.value,
        "source_ref": record.source_ref,
    }


def _parse_timeline_location(value: str) -> tuple[str, str] | None:
    """解析"时间：午夜；地点：雾港"这类最小位置事实。"""

    time_marker = _extract_labeled_value(value, "时间")
    location = _extract_labeled_value(value, "地点")
    if time_marker and location:
        return time_marker, location
    return None


def _extract_labeled_value(value: str, label: str) -> str | None:
    for separator in ("：", ":"):
        marker = f"{label}{separator}"
        start = value.find(marker)
        if start < 0:
            continue
        value_start = start + len(marker)
        value_end = value_start
        while value_end < len(value) and value[value_end] not in "；;，,。.\n\r\t ":
            value_end += 1
        extracted = value[value_start:value_end].strip()
        if extracted:
            return extracted
    return None


def _observed_location_after_character(content: str, entity_id: str) -> str | None:
    marker = f"{entity_id}在"
    start = content.find(marker)
    if start < 0:
        return None
    value_start = start + len(marker)
    value_end = value_start
    while value_end < len(content) and content[value_end] not in "，,。.;；\n\r\t ":
        value_end += 1
    observed = content[value_start:value_end].strip()
    for verb in ("点亮", "走进", "走向", "寻找", "举起", "向"):
        if verb in observed:
            observed = observed.split(verb, 1)[0].strip()
    return observed or None


def _forbidden_trait_phrases(value: object) -> list[str]:
    """从 forbidden_traits JSON 中递归抽取禁止短语。"""

    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        phrases: list[str] = []
        for item in value:
            phrases.extend(_forbidden_trait_phrases(item))
        return _unique_strings(phrases)
    if isinstance(value, dict):
        phrases: list[str] = []
        for key, item in value.items():
            if str(key) in {"替换", "replacements", "replacement_text"}:
                continue
            phrases.extend(_forbidden_trait_phrases(item))
        return _unique_strings(phrases)
    return []


def _forbidden_replacement_map(value: object) -> dict[str, str]:
    """读取 forbidden_traits 中显式声明的替换文本。"""

    if not isinstance(value, dict):
        return {}
    raw_map = value.get("替换") or value.get("replacements")
    if not isinstance(raw_map, dict):
        return {}
    return {str(key): str(replacement) for key, replacement in raw_map.items() if str(key).strip()}


def _unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            unique.append(value)
    return unique
