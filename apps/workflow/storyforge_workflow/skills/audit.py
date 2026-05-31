from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any

_SCHEMA_VERSION = "bookrun_skill_projection.v1"
_EVENT_NAME = "skill.post"
_SKILL_VERSION = "1.0.0"
_PROVENANCE = "workflow_progress_projection"


@dataclass(frozen=True)
class NovelSkillRunEvent:
    """从 BookLoop progress 派生的技能运行审计事件，只保存引用字段。"""

    event_name: str
    skill_name: str
    skill_version: str
    stage: str
    status: str
    provenance: str
    input_refs: Mapping[str, object] = field(default_factory=dict)
    output_refs: Mapping[str, object] = field(default_factory=dict)
    metadata: Mapping[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "input_refs", _freeze_mapping(self.input_refs))
        object.__setattr__(self, "output_refs", _freeze_mapping(self.output_refs))
        object.__setattr__(self, "metadata", _freeze_mapping(self.metadata))


@dataclass(frozen=True)
class BookRunSkillProjection:
    """BookRun 的只读技能链投影，供审计与诊断读取。"""

    schema_version: str
    book_run_id: int
    status: str
    events: tuple[NovelSkillRunEvent, ...]
    summary: Mapping[str, object]

    def __post_init__(self) -> None:
        object.__setattr__(self, "events", tuple(self.events))
        object.__setattr__(self, "summary", _freeze_mapping(self.summary))


def derive_skill_chain_projection(
    book_run_id: int,
    status: str,
    progress: Mapping[str, Any],
) -> BookRunSkillProjection:
    """把 BookLoop progress 转换为引用化技能链投影，不复制完整提示词或正文。"""

    events: list[NovelSkillRunEvent] = []
    for chapter in _mapping_items(progress.get("completed_chapters")):
        if chapter.get("status", "approved") == "approved":
            events.extend(_approved_chapter_events(chapter))

    blocked_chapter = progress.get("blocked_chapter")
    if isinstance(blocked_chapter, Mapping):
        events.extend(_blocked_chapter_events(blocked_chapter))

    if status == "completed":
        events.append(_export_event(book_run_id, progress))

    return BookRunSkillProjection(
        schema_version=_SCHEMA_VERSION,
        book_run_id=book_run_id,
        status=status,
        events=tuple(events),
        summary=_summary(progress, events),
    )


def _approved_chapter_events(chapter: Mapping[str, Any]) -> tuple[NovelSkillRunEvent, ...]:
    return (
        _chapter_event(
            skill_name="generate",
            status="generated",
            chapter=chapter,
            output_refs={"model_run_id": chapter.get("model_run_id")},
            metadata=_generation_metadata(chapter),
        ),
        _chapter_event(
            skill_name="judge",
            status="pass",
            chapter=chapter,
            output_refs={
                "judge_report_id": chapter.get("judge_report_id"),
                "repair_patch_id": chapter.get("repair_patch_id"),
            },
        ),
        _chapter_event(
            skill_name="approve",
            status="approved",
            chapter=chapter,
            output_refs={"approved_scene_id": chapter.get("approved_scene_id")},
        ),
        _chapter_event(
            skill_name="memory_extract",
            status="memory_extracted",
            chapter=chapter,
            output_refs={"memory_atom_ids": tuple(chapter.get("memory_atom_ids") or ())},
        ),
    )


def _blocked_chapter_events(chapter: Mapping[str, Any]) -> tuple[NovelSkillRunEvent, ...]:
    judge_status = "repair" if chapter.get("repair_patch_id") is not None else str(chapter.get("status", "awaiting_review"))
    events = [
        _chapter_event(
            skill_name="generate",
            status="generated",
            chapter=chapter,
            output_refs={"model_run_id": chapter.get("model_run_id")},
            metadata=_generation_metadata(chapter),
        ),
        _chapter_event(
            skill_name="judge",
            status=judge_status,
            chapter=chapter,
            output_refs={
                "judge_report_id": chapter.get("judge_report_id"),
                "repair_patch_id": chapter.get("repair_patch_id"),
            },
        ),
    ]
    if chapter.get("repair_patch_id") is not None:
        events.append(
            _chapter_event(
                skill_name="repair",
                status="repair",
                chapter=chapter,
                output_refs={"repair_patch_id": chapter.get("repair_patch_id")},
            )
        )
    return tuple(events)


def _export_event(book_run_id: int, progress: Mapping[str, Any]) -> NovelSkillRunEvent:
    checkpoint = tuple(_mapping_items(progress.get("checkpoint")))
    return NovelSkillRunEvent(
        event_name=_EVENT_NAME,
        skill_name="export",
        skill_version=_SKILL_VERSION,
        stage="book",
        status="completed",
        provenance=_PROVENANCE,
        input_refs={"book_run_id": book_run_id, "checkpoint_count": len(checkpoint)},
        output_refs={"book_artifact_ref": f"book_run:{book_run_id}:export", "checkpoint_count": len(checkpoint)},
        metadata={"budget": progress.get("budget") or {}},
    )


def _chapter_event(
    *,
    skill_name: str,
    status: str,
    chapter: Mapping[str, Any],
    output_refs: Mapping[str, object],
    metadata: Mapping[str, object] | None = None,
) -> NovelSkillRunEvent:
    return NovelSkillRunEvent(
        event_name=_EVENT_NAME,
        skill_name=skill_name,
        skill_version=_SKILL_VERSION,
        stage="chapter",
        status=status,
        provenance=_PROVENANCE,
        input_refs={"chapter_index": chapter.get("chapter_index")},
        output_refs=output_refs,
        metadata=metadata or {},
    )


def _summary(progress: Mapping[str, Any], events: Sequence[NovelSkillRunEvent]) -> Mapping[str, object]:
    blocked_chapter = progress.get("blocked_chapter")
    blocked_chapter_index = None
    if isinstance(blocked_chapter, Mapping):
        blocked_chapter_index = blocked_chapter.get("chapter_index")
    return {
        "event_count": len(events),
        "completed_chapter_count": len(tuple(_mapping_items(progress.get("completed_chapters")))),
        "blocked_chapter_index": blocked_chapter_index,
        "provider_degradation": progress.get("provider_degradation"),
        "budget": progress.get("budget") or {},
    }


def _generation_metadata(chapter: Mapping[str, Any]) -> Mapping[str, object]:
    metadata: dict[str, object] = {}
    fallback_metadata = chapter.get("fallback_metadata")
    if fallback_metadata is not None:
        metadata["fallback_metadata"] = fallback_metadata
    for field_name in ("token_usage", "elapsed_time_sec", "cost_estimate"):
        if field_name in chapter:
            metadata[field_name] = chapter[field_name]
    return metadata


def _mapping_items(value: object) -> tuple[Mapping[str, Any], ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(item for item in value if isinstance(item, Mapping))


def _freeze_mapping(value: Mapping[str, object]) -> Mapping[str, object]:
    return MappingProxyType({str(key): _freeze_value(item) for key, item in value.items()})


def _freeze_value(value: object) -> object:
    if isinstance(value, Mapping):
        return MappingProxyType({str(key): _freeze_value(item) for key, item in value.items()})
    if isinstance(value, list | tuple):
        return tuple(_freeze_value(item) for item in value)
    if isinstance(value, set | frozenset):
        return frozenset(_freeze_value(item) for item in value)
    return value
