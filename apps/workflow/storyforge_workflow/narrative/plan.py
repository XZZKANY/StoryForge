"""Narrative plan data structures and normalization helpers."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class EntityRef:
    display: str
    aliases: tuple[str, ...] = ()

    @classmethod
    def from_value(cls, value: Any) -> EntityRef:
        if isinstance(value, EntityRef):
            return value
        if isinstance(value, Mapping):
            display = str(value.get("display") or value.get("name") or value.get("id") or "").strip()
            aliases = _string_tuple(value.get("aliases", ()))
            return cls(display=display, aliases=aliases)
        return cls(display=str(value).strip())


@dataclass(frozen=True)
class EntityBudget:
    key_characters: int = 5
    core_locations: int = 3
    core_evidence: int = 3
    major_reversals: int = 2
    new_core_entities_after_chapter_20: int = 0
    new_mysteries_after_chapter_25: int = 0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None) -> EntityBudget:
        if not data:
            return cls()
        allowed = cls.__dataclass_fields__.keys()
        return cls(**{key: int(data[key]) for key in allowed if key in data})

    def compact_summary(self) -> dict[str, int]:
        return {
            "key_characters": self.key_characters,
            "core_locations": self.core_locations,
            "core_evidence": self.core_evidence,
            "major_reversals": self.major_reversals,
            "new_core_entities_after_chapter_20": self.new_core_entities_after_chapter_20,
            "new_mysteries_after_chapter_25": self.new_mysteries_after_chapter_25,
        }


@dataclass(frozen=True)
class NarrativePhasePolicy:
    phase: str = ""
    allowed_expansion: bool = True
    notes: str = ""

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None) -> NarrativePhasePolicy:
        if not data:
            return cls()
        return cls(
            phase=str(data.get("phase") or "").strip(),
            allowed_expansion=bool(data.get("allowed_expansion", True)),
            notes=str(data.get("notes") or "").strip(),
        )

    def compact_summary(self) -> dict[str, str | bool]:
        return {"phase": self.phase, "allowed_expansion": self.allowed_expansion}


@dataclass(frozen=True)
class RepetitionPattern:
    key: str
    terms: tuple[str, ...] = ()
    threshold: int = 3

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None) -> RepetitionPattern:
        if not data:
            return cls(key="")
        return cls(
            key=str(data.get("key") or "").strip(),
            terms=_string_tuple(data.get("terms")),
            threshold=_positive_int(data.get("threshold"), default=3),
        )


@dataclass(frozen=True)
class RepetitionPolicy:
    tracked_motifs: tuple[RepetitionPattern, ...] = ()
    tracked_action_patterns: tuple[RepetitionPattern, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any] | None) -> RepetitionPolicy:
        if not data:
            return cls()
        motifs = tuple(
            pattern
            for pattern in (
                RepetitionPattern.from_dict(item) for item in _mapping_sequence(data.get("tracked_motifs"))
            )
            if pattern.key
        )
        action_patterns = tuple(
            pattern
            for pattern in (
                RepetitionPattern.from_dict(item)
                for item in _mapping_sequence(data.get("tracked_action_patterns"))
            )
            if pattern.key
        )
        return cls(
            tracked_motifs=motifs,
            tracked_action_patterns=action_patterns,
        )

    def compact_summary(self) -> dict[str, int]:
        return {
            "tracked_motifs": len(self.tracked_motifs),
            "tracked_action_patterns": len(self.tracked_action_patterns),
        }


@dataclass(frozen=True)
class ChapterBeat:
    chapter: int
    function: str
    summary: str = ""
    relationship_change: str = ""
    irreversible_consequence: str = ""
    new_core_entities: Mapping[str, tuple[str, ...]] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ChapterBeat:
        return cls(
            chapter=int(data.get("chapter", 0)),
            function=str(data.get("function") or "").strip(),
            summary=str(data.get("summary") or "").strip(),
            relationship_change=str(data.get("relationship_change") or "").strip(),
            irreversible_consequence=str(data.get("irreversible_consequence") or "").strip(),
            new_core_entities=_normalize_entity_delta(data.get("new_core_entities")),
        )

    def compact_summary(self) -> dict[str, Any]:
        return {
            "chapter": self.chapter,
            "function": self.function,
            "has_relationship_change": bool(self.relationship_change),
            "has_irreversible_consequence": bool(self.irreversible_consequence),
            "new_core_entities": {key: list(values) for key, values in self.new_core_entities.items() if values},
        }


@dataclass(frozen=True)
class NarrativePlan:
    premise: str
    truth: str
    protagonist_arc: str
    antagonist_motive: str
    allowed_characters: tuple[EntityRef, ...] = ()
    allowed_locations: tuple[str, ...] = ()
    allowed_evidence: tuple[str, ...] = ()
    allowed_mysteries: tuple[str, ...] = ()
    major_reversals: tuple[str, ...] = ()
    chapter_beats: tuple[ChapterBeat, ...] = ()
    phase_policy: NarrativePhasePolicy = field(default_factory=NarrativePhasePolicy)
    entity_budget: EntityBudget = field(default_factory=EntityBudget)
    repetition_policy: RepetitionPolicy = field(default_factory=RepetitionPolicy)
    locked: bool = False

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> NarrativePlan:
        return cls(
            premise=str(data.get("premise") or "").strip(),
            truth=str(data.get("truth") or "").strip(),
            protagonist_arc=str(data.get("protagonist_arc") or "").strip(),
            antagonist_motive=str(data.get("antagonist_motive") or "").strip(),
            allowed_characters=tuple(EntityRef.from_value(item) for item in _sequence(data.get("allowed_characters"))),
            allowed_locations=_string_tuple(data.get("allowed_locations")),
            allowed_evidence=_string_tuple(data.get("allowed_evidence")),
            allowed_mysteries=_string_tuple(data.get("allowed_mysteries")),
            major_reversals=_string_tuple(data.get("major_reversals")),
            chapter_beats=tuple(ChapterBeat.from_dict(item) for item in _mapping_sequence(data.get("chapter_beats"))),
            phase_policy=NarrativePhasePolicy.from_dict(_maybe_mapping(data.get("phase_policy"))),
            entity_budget=EntityBudget.from_dict(_maybe_mapping(data.get("entity_budget"))),
            repetition_policy=RepetitionPolicy.from_dict(_maybe_mapping(data.get("repetition_policy"))),
            locked=bool(data.get("locked", False)),
        )

    def compact_summary(self) -> dict[str, Any]:
        return {
            "premise": self.premise,
            "truth": self.truth,
            "protagonist_arc": self.protagonist_arc,
            "antagonist_motive": self.antagonist_motive,
            "locked": self.locked,
            "allowed_characters": [item.display for item in self.allowed_characters],
            "allowed_locations": list(self.allowed_locations),
            "allowed_evidence": list(self.allowed_evidence),
            "allowed_mysteries": list(self.allowed_mysteries),
            "major_reversal_count": len(self.major_reversals),
            "chapter_count": len(self.chapter_beats),
            "chapter_beats": [beat.compact_summary() for beat in self.chapter_beats],
            "phase_policy": self.phase_policy.compact_summary(),
            "entity_budget": self.entity_budget.compact_summary(),
            "repetition_policy": self.repetition_policy.compact_summary(),
        }


def _sequence(value: Any) -> Sequence[Any]:
    if value is None:
        return ()
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return value
    return (value,)


def _mapping_sequence(value: Any) -> Sequence[Mapping[str, Any]]:
    return tuple(item for item in _sequence(value) if isinstance(item, Mapping))


def _maybe_mapping(value: Any) -> Mapping[str, Any] | None:
    return value if isinstance(value, Mapping) else None


def _string_tuple(value: Any) -> tuple[str, ...]:
    return tuple(str(item).strip() for item in _sequence(value) if str(item).strip())


def _positive_int(value: Any, *, default: int) -> int:
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return default


def _normalize_entity_delta(value: Any) -> dict[str, tuple[str, ...]]:
    if not isinstance(value, Mapping):
        return {}
    return {str(key): _string_tuple(items) for key, items in value.items()}
