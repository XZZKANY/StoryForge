from __future__ import annotations

import os
import re
from collections.abc import Mapping, Sequence
from typing import Any

from storyforge_workflow.prompts.models import ContinuityFact


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    return None


def _prioritized_continuity_entries(
    entries: list[tuple[int, Mapping[str, Any] | None, ContinuityFact]],
    state: Mapping[str, Any],
) -> list[ContinuityFact]:
    current_chapter = _positive_int(state.get("chapter_index")) or _positive_int(state.get("chapter_id")) or 0
    pov = _state_pov(state)
    return [
        fact
        for _, _, fact in sorted(
            entries,
            key=lambda item: _continuity_sort_key(item, current_chapter=current_chapter, pov=pov),
        )
    ]


def _continuity_sort_key(
    item: tuple[int, Mapping[str, Any] | None, ContinuityFact],
    *,
    current_chapter: int,
    pov: str,
) -> tuple[int, int, int, int]:
    index, raw, fact = item
    chapter = _fact_chapter(raw, fact.source_ref)
    distance = abs(current_chapter - chapter) if current_chapter and chapter else 1_000_000
    return (
        0 if fact.must_appear else 1,
        0 if _matches_pov(raw, fact.statement, pov) else 1,
        distance,
        index,
    )


def _within_continuity_budget(facts: Sequence[ContinuityFact]) -> list[ContinuityFact]:
    budget = _env_positive_int("STORYFORGE_CONTINUITY_FACT_TOKEN_BUDGET")
    if budget is None:
        return list(facts)
    selected: list[ContinuityFact] = []
    used = 0
    for fact in facts:
        cost = _estimated_fact_tokens(fact)
        if selected and used + cost > budget:
            continue
        if cost > budget:
            continue
        selected.append(fact)
        used += cost
    return selected


def _estimated_fact_tokens(fact: ContinuityFact) -> int:
    return max(1, (len(fact.statement) + 1) // 2 + 1)


def _env_positive_int(name: str) -> int | None:
    raw = os.getenv(name)
    if raw is None:
        return None
    try:
        parsed = int(raw)
    except ValueError:
        return None
    return parsed if parsed > 0 else None


def _state_pov(state: Mapping[str, Any]) -> str:
    style = state.get("style_directive")
    if isinstance(style, Mapping):
        return _str(style.get("pov"))
    return ""


def _matches_pov(raw: Mapping[str, Any] | None, statement: str, pov: str) -> bool:
    if not pov:
        return False
    if raw is not None:
        for key in ("pov", "character", "character_name", "entity_id"):
            if _str(raw.get(key)) == pov:
                return True
        if _str(raw.get("character_role")) in {"主角", "POV", "pov", "protagonist"}:
            return True
    return pov in statement


def _fact_chapter(raw: Mapping[str, Any] | None, source_ref: str) -> int | None:
    if raw is not None:
        for key in ("chapter_index", "chapter_ordinal", "valid_from_chapter"):
            parsed = _positive_int(raw.get(key))
            if parsed is not None:
                return parsed
    match = re.search(r"chapter:(\d+)", source_ref)
    if match:
        return int(match.group(1))
    return None


def _str(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ("" if value is None else str(value))
