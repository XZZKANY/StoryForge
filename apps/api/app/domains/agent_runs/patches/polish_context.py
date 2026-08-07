"""Project trusted LLM context into conservative polishing constraints."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import PurePosixPath
from typing import Any, TypedDict


class PolishContextConstraints(TypedDict):
    protected_entities: list[str]
    character_constraints: list[dict[str, Any]]
    continuity_facts: list[dict[str, Any]]
    required_facts: list[str]


_ENTITY_FILE_KINDS = frozenset({"character", "setting"})
_CONTINUITY_FILE_KINDS = frozenset({"setting", "timeline", "foreshadowing"})
_REQUIRED_CHAPTER_KEYS = (
    "goal",
    "setting",
    "beat",
    "beats",
    "outline",
    "chapter_outline",
    "current_scene",
)
_MAX_ENTITIES = 24
_MAX_CHARACTER_CONSTRAINTS = 8
_MAX_FACTS = 24


def polish_constraints_from_context_snapshot(snapshot: object) -> PolishContextConstraints:
    """Extract only explicit, sanitized author context; never infer facts from prose."""

    result: PolishContextConstraints = {
        "protected_entities": [],
        "character_constraints": [],
        "continuity_facts": [],
        "required_facts": [],
    }
    if not isinstance(snapshot, Mapping) or snapshot.get("kind") != "llm_context_snapshot":
        return result

    files = snapshot.get("context_files")
    if isinstance(files, list):
        for item in files:
            if not isinstance(item, Mapping):
                continue
            kind = _text(item.get("kind"))
            relative_path = _text(item.get("relative_path"))
            excerpt = _text(item.get("excerpt"))
            entity = _context_file_entity(item) if kind in _ENTITY_FILE_KINDS else None
            if entity is not None:
                _append_unique(result["protected_entities"], entity, limit=_MAX_ENTITIES)
            if kind == "character" and excerpt and len(result["character_constraints"]) < _MAX_CHARACTER_CONSTRAINTS:
                constraint: dict[str, Any] = {"notes": excerpt}
                if entity is not None:
                    constraint["name"] = entity
                if relative_path:
                    constraint["path"] = relative_path
                result["character_constraints"].append(constraint)
            if kind in _CONTINUITY_FILE_KINDS and excerpt and len(result["continuity_facts"]) < _MAX_FACTS:
                fact: dict[str, Any] = {"statement": excerpt}
                if relative_path:
                    fact["source_path"] = relative_path
                result["continuity_facts"].append(fact)

    story_memory = snapshot.get("story_memory")
    memory_items = story_memory.get("items") if isinstance(story_memory, Mapping) else None
    if isinstance(memory_items, list):
        for item in memory_items:
            if not isinstance(item, Mapping):
                continue
            entity = _text(item.get("entity"))
            fact = _text(item.get("text"))
            if entity:
                _append_unique(result["protected_entities"], entity, limit=_MAX_ENTITIES)
            if fact:
                _append_unique(result["required_facts"], fact, limit=_MAX_FACTS)

    chapter_context = snapshot.get("chapter_context")
    if isinstance(chapter_context, Mapping):
        for key in _REQUIRED_CHAPTER_KEYS:
            for fact in _fact_strings(chapter_context.get(key)):
                _append_unique(result["required_facts"], fact, limit=_MAX_FACTS)

    return result


def _context_file_entity(item: Mapping[str, Any]) -> str | None:
    title = _text(item.get("title")) or _text(item.get("relative_path"))
    if not title:
        return None
    name = PurePosixPath(title.replace("\\", "/")).name
    suffix = PurePosixPath(name).suffix.lower()
    if suffix in {".md", ".markdown", ".txt"}:
        name = name[: -len(suffix)]
    return name.strip() or None


def _fact_strings(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        return (value.strip(),) if value.strip() else ()
    if isinstance(value, list):
        return tuple(item.strip() for item in value if isinstance(item, str) and item.strip())
    return ()


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _append_unique(target: list[str], value: str, *, limit: int) -> None:
    if len(target) < limit and value not in target:
        target.append(value)
