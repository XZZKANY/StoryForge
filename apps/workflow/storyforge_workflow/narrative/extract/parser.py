"""Parse LLM narrative fact extraction output."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from storyforge_workflow.narrative.extract.facts import (
    NarrativeSceneFact,
    clean_text,
    clean_tuple,
)


def parse_narrative_scene_fact(raw: str, *, default_chapter: int) -> NarrativeSceneFact:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return NarrativeSceneFact.failed(chapter=default_chapter, error="invalid_json")

    if isinstance(payload, list):
        payload = payload[0] if payload else None

    if not isinstance(payload, Mapping):
        return NarrativeSceneFact.failed(chapter=default_chapter, error="invalid_shape")

    return NarrativeSceneFact(
        chapter=_clean_chapter(payload.get("chapter"), default_chapter),
        primary_scene_mode=clean_text(payload.get("primary_scene_mode")),
        action_sequence=clean_tuple(payload.get("action_sequence")),
        conflict_type=clean_text(payload.get("conflict_type")),
        protagonist_mistake=clean_text(payload.get("protagonist_mistake")),
        cost=clean_text(payload.get("cost")),
        relationship_delta=clean_text(payload.get("relationship_delta")),
        irreversible_consequence=clean_text(payload.get("irreversible_consequence")),
        clue_usage_mode=clean_text(payload.get("clue_usage_mode")),
        new_evidence=clean_tuple(payload.get("new_evidence")),
        existing_clues_reinterpreted=clean_tuple(
            payload.get("existing_clues_reinterpreted")
        ),
        deletable=payload.get("deletable") is True,
    )


def _clean_chapter(value: Any, default_chapter: int) -> int:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return default_chapter
