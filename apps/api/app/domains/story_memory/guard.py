from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.domains.story_memory.schemas import MemoryAtom
from app.domains.story_memory.service import get_active_memory_atoms

_GUARDED_FACT_TYPES = {"status", "location", "rule"}
_HIGH_CONFIDENCE_THRESHOLD = 0.9
_LIVING_ACTION_MARKERS = (
    "呼吸",
    "开口",
    "说",
    "回答",
    "推开",
    "走",
    "穿越",
    "亲自",
    "带队",
    "现身",
)
_DEATH_MARKERS = ("死亡", "已经死亡", "已死", "身亡", "去世", "牺牲")
_NEGATION_MARKERS = ("无需", "不需要", "没有必要", "不必", "绕过")
_LEAVE_LOCATION_MARKERS = ("离开", "脱离", "逃出", "现身", "抵达")


def check_story_memory_continuity(
    session: Session,
    *,
    book_id: int,
    chapter_id: int,
    draft: str,
) -> list[dict[str, str]]:
    """用 Story Memory 的当前有效事实拦截高置信连续性硬冲突。"""

    prose = draft.strip() if isinstance(draft, str) else ""
    if not prose:
        return []
    issues: list[dict[str, str]] = []
    for atom in get_active_memory_atoms(session, book_id=book_id, chapter_id=chapter_id):
        if not _should_guard(atom):
            continue
        if (
            _violates_status_fact(atom, prose)
            or _violates_rule_fact(atom, prose)
            or _violates_location_fact(atom, prose)
        ):
            issues.append(_issue_for(atom))
            break
    return issues


def _should_guard(atom: MemoryAtom) -> bool:
    if atom.fact_type not in _GUARDED_FACT_TYPES:
        return False
    return atom.immutable or atom.confidence >= _HIGH_CONFIDENCE_THRESHOLD


def _violates_status_fact(atom: MemoryAtom, prose: str) -> bool:
    if atom.fact_type != "status" or not _mentions_entity(atom, prose):
        return False
    if any(marker in atom.value for marker in _DEATH_MARKERS):
        return any(marker in prose for marker in _LIVING_ACTION_MARKERS) and not any(
            marker in prose for marker in _DEATH_MARKERS
        )
    return False


def _violates_rule_fact(atom: MemoryAtom, prose: str) -> bool:
    if atom.fact_type != "rule":
        return False
    value_terms = _key_terms(atom.value)
    if not value_terms or not any(term in prose for term in value_terms[:2]):
        return False
    return any(marker in prose for marker in _NEGATION_MARKERS)


def _violates_location_fact(atom: MemoryAtom, prose: str) -> bool:
    if atom.fact_type != "location" or not _mentions_entity(atom, prose):
        return False
    if "被困" not in atom.value:
        return False
    location = _trapped_location(atom.value)
    if location is None or location not in prose:
        return False
    return any(marker in prose for marker in _LEAVE_LOCATION_MARKERS)


def _mentions_entity(atom: MemoryAtom, prose: str) -> bool:
    return atom.entity_id in prose or any(term in prose for term in _key_terms(atom.value)[:1])


def _trapped_location(value: str) -> str | None:
    match = re.search(r"被困在([^，。！？\s]+)", value)
    return match.group(1) if match else None


def _key_terms(text: str) -> list[str]:
    return [part for part in re.split(r"[，。、“”\s/]+", text) if len(part) >= 2]


def _issue_for(atom: MemoryAtom) -> dict[str, str]:
    return {
        "dimension": "连续性",
        "severity": "high",
        "snippet": atom.value,
        "message": f"草稿疑似违反 Story Memory 中已生效的高置信事实：{atom.value}",
        "suggestion": "保留既定事实，删除或重写与长期记忆冲突的动作、对白或设定表达。",
        "revision_strategy": "regenerate",
    }
