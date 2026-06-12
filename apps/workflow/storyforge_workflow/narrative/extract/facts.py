"""Structured facts extracted from narrative scene prose."""

from __future__ import annotations

from dataclasses import dataclass


def clean_text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def clean_tuple(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        item = clean_text(value)
        return (item,) if item else ()
    if not isinstance(value, (list, tuple, set)):
        return ()

    cleaned: list[str] = []
    for raw in value:
        item = clean_text(raw)
        if item:
            cleaned.append(item)
    return tuple(cleaned)


@dataclass(frozen=True)
class NarrativeSceneFact:
    chapter: int
    primary_scene_mode: str = ""
    action_sequence: tuple[str, ...] = ()
    conflict_type: str = ""
    protagonist_mistake: str = ""
    cost: str = ""
    relationship_delta: str = ""
    irreversible_consequence: str = ""
    clue_usage_mode: str = ""
    new_evidence: tuple[str, ...] = ()
    existing_clues_reinterpreted: tuple[str, ...] = ()
    deletable: bool = False
    extraction_failed: bool = False
    extraction_error: str = ""

    @classmethod
    def failed(cls, *, chapter: int, error: str) -> NarrativeSceneFact:
        return cls(chapter=chapter, extraction_failed=True, extraction_error=error)
