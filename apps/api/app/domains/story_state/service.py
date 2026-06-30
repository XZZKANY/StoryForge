from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import ConflictError, NotFoundError
from app.domains.book_runs.models import BookRun
from app.domains.books.models import Book
from app.domains.continuity.edge_constraints import ContinuityEdgeCandidate, check_edge_constraints
from app.domains.continuity.models import ContinuityEdge
from app.domains.story_state.models import StoryStateEvent, StoryStateLedger
from app.domains.story_state.schemas import (
    CommitStoryStateResult,
    CommittedStoryStateEvent,
    StateChangeInput,
    StoryStateGroundingResult,
)

_FORESHADOW_PHASE_ORDER = {
    "setup": 1,
    "seeded": 1,
    "埋下": 1,
    "已埋": 1,
    "active": 2,
    "推进": 2,
    "payoff": 3,
    "resolved": 3,
    "closed": 3,
    "已收": 3,
    "回收": 3,
}
_CONFLICT_PHASE_ORDER = {
    "pending": 1,
    "未启动": 1,
    "active": 2,
    "进行中": 2,
    "climax": 3,
    "高潮": 3,
    "resolved": 4,
    "已解决": 4,
}
_TERMINAL_STATUSES = {"resolved", "completed", "cancelled", "broken", "已完成", "已解决", "取消", "违背"}
_EDGE_ENTITY_KINDS = {"relationship", "timeline", "timeline_order", "status"}
_EDGE_KIND_ALIASES = {
    "relationship": "relationship",
    "timeline": "timeline_order",
    "timeline_order": "timeline_order",
    "status": "status",
}


class StoryStateNotFoundError(NotFoundError):
    """故事状态提交引用的作品或运行不存在。"""


class StoryStateGroundingError(ConflictError):
    """CHANGES 无法在正文中接地时拒绝提交。"""

    def __init__(self, grounding: list[StoryStateGroundingResult]) -> None:
        self.grounding = grounding
        failed = [item for item in grounding if item.hard == "fail"]
        summary = "；".join(item.reason or f"{item.entity_id} 未接地" for item in failed)
        super().__init__(f"故事状态 grounding 失败，拒绝提交：{summary}")


class StoryStateInvariantError(ConflictError):
    """CHANGES 违反确定性故事状态不变量。"""


SemanticGrounder = Callable[[str, Sequence[StateChangeInput]], Mapping[int, object]]


@dataclass
class _ProjectedLedger:
    entity_kind: str
    entity_id: str
    canonical_name: str
    aliases: list[str]
    state: dict[str, object]
    last_chapter: int


def commit_story_state_changes(
    session: Session,
    *,
    book_id: int,
    chapter_index: int,
    prose: str,
    changes: Sequence[StateChangeInput | Mapping[str, object]],
    book_run_id: int | None = None,
    semantic_grounder: SemanticGrounder | None = None,
    drop_ungroundable: bool = False,
) -> CommitStoryStateResult:
    """提交一章的结构化故事状态变化，失败时整批不落库。

    drop_ungroundable=True 时不再因「单条 change 的 surface_forms 未出现在正文」整批拒绝，
    而是丢弃这些无法核实的 change（不可核实的状态绝不入账）、提交其余。适用于整书自动
    生成路径：一条别名错配的 change 不应连累整章好正文。显式工具/接口提交仍用默认严格语义。
    """

    _assert_scope(session, book_id=book_id, book_run_id=book_run_id)
    normalized = [_coerce_change(item, seq=index) for index, item in enumerate(changes, start=1)]
    grounding = [_ground_change(change, prose) for change in normalized]
    dropped_grounding: list[StoryStateGroundingResult] = []
    if any(item.hard == "fail" for item in grounding):
        if not drop_ungroundable:
            raise StoryStateGroundingError(grounding)
        kept = [(change, result) for change, result in zip(normalized, grounding, strict=True) if result.hard != "fail"]
        dropped_grounding = [result for result in grounding if result.hard == "fail"]
        normalized = [change for change, _ in kept]
        grounding = [result for _, result in kept]
        if not normalized:
            return CommitStoryStateResult(
                events=[], grounding=[], ledger_updates=0, edge_count=0, dropped_grounding=dropped_grounding
            )
    grounding = _apply_semantic_grounding(
        prose=prose,
        changes=normalized,
        grounding=grounding,
        semantic_grounder=semantic_grounder,
    )

    projected = _current_ledgers(session, book_id=book_id, book_run_id=book_run_id)
    touched: set[tuple[str, str]] = set()
    edge_changes: list[StateChangeInput] = []
    for change in normalized:
        if _is_edge_change(change):
            edge_changes.append(change)
            continue
        key = (change.entity_kind, change.entity_id)
        current = projected.get(key) or _new_projected_ledger(change, chapter_index)
        next_state = _apply_change_to_state(current.state, change, chapter_index)
        projected[key] = _ProjectedLedger(
            entity_kind=change.entity_kind,
            entity_id=change.entity_id,
            canonical_name=_canonical_name(change, current.canonical_name),
            aliases=_merged_aliases(current.aliases, change),
            state=next_state,
            last_chapter=chapter_index,
        )
        touched.add(key)

    try:
        edge_count = _stage_continuity_edges(
            session,
            book_id=book_id,
            book_run_id=book_run_id,
            chapter_index=chapter_index,
            changes=edge_changes,
        )
        events: list[StoryStateEvent] = []
        for change, result in zip(normalized, grounding, strict=True):
            grounding_payload = result.model_dump()
            grounding_payload["canonical_name"] = change.canonical_name
            grounding_payload["aliases"] = _clean_strings(change.aliases)
            events.append(
                StoryStateEvent(
                    book_id=book_id,
                    book_run_id=book_run_id,
                    chapter_index=chapter_index,
                    seq=int(change.seq or 1),
                    change_type=change.change_type,
                    entity_kind=change.entity_kind,
                    entity_id=change.entity_id,
                    object_id=change.object_id,
                    payload=dict(change.payload),
                    grounding=grounding_payload,
                )
            )
        session.add_all(events)
        session.flush()

        _persist_touched_ledgers(
            session,
            book_id=book_id,
            book_run_id=book_run_id,
            projected=projected,
            touched=touched,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise
    for event in events:
        session.refresh(event)

    return CommitStoryStateResult(
        events=[
            CommittedStoryStateEvent(
                event_id=event.id,
                chapter_index=event.chapter_index,
                seq=event.seq,
                change_type=event.change_type,
                entity_kind=event.entity_kind,
                entity_id=event.entity_id,
                object_id=event.object_id,
            )
            for event in events
        ],
        grounding=grounding,
        ledger_updates=len(touched),
        edge_count=edge_count,
        dropped_grounding=dropped_grounding,
    )


def reproject_story_state(
    session: Session,
    *,
    book_id: int,
    book_run_id: int | None = None,
    through_chapter: int | None = None,
) -> int:
    """按事件日志重建当前态投影；指定章节时先删除其后的事件。"""

    _assert_scope(session, book_id=book_id, book_run_id=book_run_id)
    if through_chapter is not None:
        future_events = session.scalars(
            _event_scope_query(book_id=book_id, book_run_id=book_run_id).where(
                StoryStateEvent.chapter_index > through_chapter
            )
        ).all()
        for event in future_events:
            session.delete(event)
        session.flush()

    _delete_story_state_edges(session, book_id=book_id, book_run_id=book_run_id, through_chapter=None)

    existing_ledgers = session.scalars(_ledger_scope_query(book_id=book_id, book_run_id=book_run_id)).all()
    for ledger in existing_ledgers:
        session.delete(ledger)
    session.flush()

    events = session.scalars(
        _event_scope_query(book_id=book_id, book_run_id=book_run_id).order_by(
            StoryStateEvent.chapter_index,
            StoryStateEvent.seq,
            StoryStateEvent.id,
        )
    ).all()
    projected: dict[tuple[str, str], _ProjectedLedger] = {}
    touched: set[tuple[str, str]] = set()
    edge_changes: list[tuple[int, StateChangeInput]] = []
    for event in events:
        change = _change_from_event(event)
        if _is_edge_change(change):
            edge_changes.append((event.chapter_index, change))
            continue
        key = (change.entity_kind, change.entity_id)
        current = projected.get(key) or _new_projected_ledger(change, event.chapter_index)
        projected[key] = _ProjectedLedger(
            entity_kind=change.entity_kind,
            entity_id=change.entity_id,
            canonical_name=_canonical_name(change, current.canonical_name),
            aliases=_merged_aliases(current.aliases, change),
            state=_apply_change_to_state(current.state, change, event.chapter_index),
            last_chapter=event.chapter_index,
        )
        touched.add(key)

    for event_chapter_index, change in edge_changes:
        _stage_continuity_edges(
            session,
            book_id=book_id,
            book_run_id=book_run_id,
            chapter_index=event_chapter_index,
            changes=[change],
        )

    _persist_touched_ledgers(
        session,
        book_id=book_id,
        book_run_id=book_run_id,
        projected=projected,
        touched=touched,
    )
    session.commit()
    return len(touched)


def _assert_scope(session: Session, *, book_id: int, book_run_id: int | None) -> None:
    book = session.get(Book, book_id)
    if book is None:
        raise StoryStateNotFoundError("作品不存在，无法提交故事状态。")
    if book_run_id is None:
        return
    book_run = session.get(BookRun, book_run_id)
    if book_run is None or book_run.book_id != book_id:
        raise StoryStateNotFoundError("BookRun 不存在或不属于当前作品，无法提交故事状态。")


def _coerce_change(change: StateChangeInput | Mapping[str, object], *, seq: int) -> StateChangeInput:
    item = change if isinstance(change, StateChangeInput) else StateChangeInput.model_validate(change)
    return item if item.seq is not None else item.model_copy(update={"seq": seq})


def _ground_change(change: StateChangeInput, prose: str) -> StoryStateGroundingResult:
    surface_forms = _clean_strings([*change.surface_forms, change.canonical_name, *change.aliases])
    if not surface_forms:
        return StoryStateGroundingResult(
            seq=int(change.seq or 1),
            entity_id=change.entity_id,
            hard="fail",
            surface_forms=[],
            reason="CHANGES 缺少可在正文定位的 surface_forms。",
        )
    matched = [item for item in surface_forms if item in prose]
    if not matched:
        return StoryStateGroundingResult(
            seq=int(change.seq or 1),
            entity_id=change.entity_id,
            hard="fail",
            surface_forms=surface_forms,
            reason=f"{change.entity_id} 的 surface_forms 未出现在本章正文。",
        )
    return StoryStateGroundingResult(
        seq=int(change.seq or 1),
        entity_id=change.entity_id,
        hard="pass",
        surface_forms=surface_forms,
        matched_surface_forms=matched,
    )


def _apply_semantic_grounding(
    *,
    prose: str,
    changes: Sequence[StateChangeInput],
    grounding: list[StoryStateGroundingResult],
    semantic_grounder: SemanticGrounder | None,
) -> list[StoryStateGroundingResult]:
    if semantic_grounder is None or not changes:
        return grounding
    try:
        advisories = dict(semantic_grounder(prose, changes))
    except Exception:
        return [
            item.model_copy(
                update={
                    "semantic_status": "advisory",
                    "semantic_score": None,
                    "semantic_reason": "semantic_grounding_failed",
                }
            )
            for item in grounding
        ]
    if not advisories:
        return grounding
    return [_grounding_with_semantic_advisory(item, advisories.get(item.seq)) for item in grounding]


def _grounding_with_semantic_advisory(
    grounding: StoryStateGroundingResult,
    advisory: object,
) -> StoryStateGroundingResult:
    if advisory is None:
        return grounding
    score = _semantic_advisory_score(advisory)
    reason = _semantic_advisory_reason(advisory)
    return grounding.model_copy(
        update={
            "semantic_status": "advisory",
            "semantic_score": score,
            "semantic_reason": reason,
        }
    )


def _semantic_advisory_score(advisory: object) -> int | None:
    value = advisory.get("semantic_score") if isinstance(advisory, Mapping) else getattr(advisory, "semantic_score", None)
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return max(0, min(100, int(value)))
    return None


def _semantic_advisory_reason(advisory: object) -> str | None:
    value = advisory.get("semantic_reason") if isinstance(advisory, Mapping) else getattr(advisory, "semantic_reason", None)
    if isinstance(value, str) and value.strip():
        return value.strip()[:300]
    return None


def _current_ledgers(
    session: Session,
    *,
    book_id: int,
    book_run_id: int | None,
) -> dict[tuple[str, str], _ProjectedLedger]:
    ledgers = session.scalars(_ledger_scope_query(book_id=book_id, book_run_id=book_run_id)).all()
    return {
        (ledger.entity_kind, ledger.entity_id): _ProjectedLedger(
            entity_kind=ledger.entity_kind,
            entity_id=ledger.entity_id,
            canonical_name=ledger.canonical_name,
            aliases=_clean_strings(ledger.aliases),
            state=dict(ledger.state or {}),
            last_chapter=ledger.last_chapter,
        )
        for ledger in ledgers
    }


def _persist_touched_ledgers(
    session: Session,
    *,
    book_id: int,
    book_run_id: int | None,
    projected: dict[tuple[str, str], _ProjectedLedger],
    touched: set[tuple[str, str]],
) -> None:
    existing = {
        (ledger.entity_kind, ledger.entity_id): ledger
        for ledger in session.scalars(_ledger_scope_query(book_id=book_id, book_run_id=book_run_id)).all()
    }
    for key in touched:
        projection = projected[key]
        ledger = existing.get(key)
        if ledger is None:
            session.add(
                StoryStateLedger(
                    book_id=book_id,
                    book_run_id=book_run_id,
                    entity_kind=projection.entity_kind,
                    entity_id=projection.entity_id,
                    canonical_name=projection.canonical_name,
                    aliases=projection.aliases,
                    state=projection.state,
                    last_chapter=projection.last_chapter,
                    version=1,
                )
            )
            continue
        ledger.canonical_name = projection.canonical_name
        ledger.aliases = projection.aliases
        ledger.state = projection.state
        ledger.last_chapter = projection.last_chapter
        ledger.version += 1


def _is_edge_change(change: StateChangeInput) -> bool:
    return change.entity_kind in _EDGE_ENTITY_KINDS


def _stage_continuity_edges(
    session: Session,
    *,
    book_id: int,
    book_run_id: int | None,
    chapter_index: int,
    changes: Sequence[StateChangeInput],
) -> int:
    edge_count = 0
    for change in changes:
        candidate = _edge_candidate_from_change(change, chapter_index=chapter_index)
        conflicts = check_edge_constraints(session, book_id=book_id, candidate=candidate)
        if conflicts:
            summary = "；".join(conflict.reason for conflict in conflicts)
            raise StoryStateInvariantError(f"连续性边冲突，拒绝提交：{summary}")
        payload = dict(change.payload)
        payload["source"] = "story_state"
        payload["book_run_id"] = book_run_id
        payload["chapter_index"] = chapter_index
        payload["change_type"] = change.change_type
        session.add(
            ContinuityEdge(
                book_id=book_id,
                edge_kind=candidate.edge_kind,
                subject_ref=candidate.subject_ref,
                predicate=candidate.predicate,
                object_ref=candidate.object_ref,
                valid_from_chapter=candidate.valid_from_chapter,
                valid_to_chapter=candidate.valid_to_chapter,
                payload=payload,
                version=1,
            )
        )
        session.flush()
        edge_count += 1
    return edge_count


def _edge_candidate_from_change(change: StateChangeInput, *, chapter_index: int) -> ContinuityEdgeCandidate:
    edge_kind = _edge_kind(change)
    object_ref = _edge_object_ref(change)
    if object_ref is None:
        raise StoryStateInvariantError(f"{change.entity_kind} CHANGES 缺少 object_id / object_ref。")
    return ContinuityEdgeCandidate(
        edge_kind=edge_kind,
        subject_ref=change.entity_id,
        predicate=_edge_predicate(change),
        object_ref=object_ref,
        valid_from_chapter=_positive_int(change.payload.get("valid_from_chapter")) or chapter_index,
        valid_to_chapter=_positive_int(change.payload.get("valid_to_chapter")),
    )


def _edge_kind(change: StateChangeInput) -> str:
    raw = _text_value(change.payload.get("edge_kind")) or change.entity_kind
    normalized = _normalized_key(raw)
    edge_kind = _EDGE_KIND_ALIASES.get(normalized)
    if edge_kind is None:
        raise StoryStateInvariantError(f"不支持的连续性边类型：{raw}。")
    return edge_kind


def _edge_predicate(change: StateChangeInput) -> str:
    predicate = _first_text(change.payload, ("predicate", "relationship", "status", "relation"))
    if predicate:
        return predicate
    return change.change_type.rsplit(".", 1)[-1] or change.change_type


def _edge_object_ref(change: StateChangeInput) -> str | None:
    return change.object_id or _first_text(change.payload, ("object_ref", "object_id", "target", "to"))


def _delete_story_state_edges(
    session: Session,
    *,
    book_id: int,
    book_run_id: int | None,
    through_chapter: int | None,
) -> None:
    edges = session.scalars(select(ContinuityEdge).where(ContinuityEdge.book_id == book_id)).all()
    for edge in edges:
        payload = edge.payload if isinstance(edge.payload, dict) else {}
        if payload.get("source") != "story_state":
            continue
        if payload.get("book_run_id") != book_run_id:
            continue
        if through_chapter is not None and edge.valid_from_chapter <= through_chapter:
            continue
        session.delete(edge)
    session.flush()


def _apply_change_to_state(
    current_state: Mapping[str, object],
    change: StateChangeInput,
    chapter_index: int,
) -> dict[str, object]:
    state = dict(current_state)
    payload = dict(change.payload)
    if change.entity_kind == "foreshadow":
        _apply_ordered_phase(
            state,
            payload,
            order=_FORESHADOW_PHASE_ORDER,
            label="伏笔",
            require_existing_for_terminal=True,
        )
    elif change.entity_kind == "conflict":
        _apply_ordered_phase(state, payload, order=_CONFLICT_PHASE_ORDER, label="冲突")
    elif change.entity_kind == "secret":
        _apply_secret_knowers(state, payload)
    elif change.entity_kind == "item":
        _apply_single_holder(state, payload, label="物品", current_key="holder", target_keys=("to", "holder", "holder_to"))
    elif change.entity_kind == "location":
        _apply_single_holder(
            state,
            payload,
            label="位置",
            current_key="location",
            target_keys=("to", "location", "location_to"),
        )
    elif change.entity_kind in {"countdown", "oath"}:
        _apply_single_terminal_state(state, payload, change, chapter_index)
    else:
        state.update(payload)
    state["last_change_type"] = change.change_type
    state["last_chapter"] = chapter_index
    return state


def _apply_ordered_phase(
    state: dict[str, object],
    payload: Mapping[str, object],
    *,
    order: Mapping[str, int],
    label: str,
    require_existing_for_terminal: bool = False,
) -> None:
    raw_phase = _first_text(payload, ("phase_to", "phase", "status", "state"))
    if raw_phase is None:
        state.update(payload)
        return
    phase = _normalized_key(raw_phase)
    if phase not in order:
        state["phase"] = raw_phase
        return
    current = _normalized_key(_text_value(state.get("phase")) or "")
    current_order = order.get(current, 0)
    next_order = order[phase]
    if require_existing_for_terminal and next_order >= 3 and current_order == 0:
        raise StoryStateInvariantError(f"{label}未建立就被回收，拒绝提交。")
    if current_order > next_order:
        raise StoryStateInvariantError(f"{label}阶段从 {current} 回退到 {phase}，拒绝提交。")
    state.update(payload)
    state["phase"] = phase


def _apply_secret_knowers(state: dict[str, object], payload: Mapping[str, object]) -> None:
    current = set(_text_list(state.get("knowers")))
    explicit = set(_text_list(payload.get("knowers")))
    additions = set(_text_list(payload.get("knowers_add")))
    single = _text_value(payload.get("knower"))
    if single:
        additions.add(single)
    removals = set(_text_list(payload.get("knowers_remove")))
    if removals & current:
        raise StoryStateInvariantError("秘密知情集只能增加，不能移除既有知情者。")
    if explicit:
        if not current.issubset(explicit):
            raise StoryStateInvariantError("秘密知情集显式更新丢失既有知情者，拒绝提交。")
        next_knowers = explicit
    else:
        next_knowers = current | additions
    state.update(payload)
    state["knowers"] = sorted(next_knowers)


def _apply_single_holder(
    state: dict[str, object],
    payload: Mapping[str, object],
    *,
    label: str,
    current_key: str,
    target_keys: tuple[str, ...],
) -> None:
    current = _text_value(state.get(current_key))
    source = _first_text(payload, ("from", f"{current_key}_from"))
    if current and source and current != source:
        raise StoryStateInvariantError(f"{label}流转来源应为 {current}，实际声明为 {source}。")
    target = _first_text(payload, target_keys)
    state.update(payload)
    if target:
        state[current_key] = target


def _apply_single_terminal_state(
    state: dict[str, object],
    payload: Mapping[str, object],
    change: StateChangeInput,
    chapter_index: int,
) -> None:
    current_status = _normalized_key(_text_value(state.get("status")) or "")
    next_status = _normalized_key(_first_text(payload, ("status", "phase", "phase_to")) or "")
    is_create = change.change_type.endswith(".create") or change.change_type.endswith(".start")
    if is_create and state and current_status not in _TERMINAL_STATUSES:
        raise StoryStateInvariantError(f"{change.entity_kind} 已存在且未终止，不能重复创建。")
    if current_status in _TERMINAL_STATUSES and next_status in _TERMINAL_STATUSES:
        raise StoryStateInvariantError(f"{change.entity_kind} 已终止，不能重复终止。")
    state.update(payload)
    if next_status:
        state["status"] = next_status
        if next_status in _TERMINAL_STATUSES:
            state["terminal_chapter"] = chapter_index


def _new_projected_ledger(change: StateChangeInput, chapter_index: int) -> _ProjectedLedger:
    return _ProjectedLedger(
        entity_kind=change.entity_kind,
        entity_id=change.entity_id,
        canonical_name=_canonical_name(change, change.entity_id),
        aliases=_merged_aliases([], change),
        state={},
        last_chapter=chapter_index,
    )


def _change_from_event(event: StoryStateEvent) -> StateChangeInput:
    grounding = event.grounding if isinstance(event.grounding, dict) else {}
    return StateChangeInput(
        change_type=event.change_type,
        entity_kind=event.entity_kind,
        entity_id=event.entity_id,
        object_id=event.object_id,
        payload=dict(event.payload or {}),
        surface_forms=_text_list(grounding.get("surface_forms")),
        canonical_name=_text_value(grounding.get("canonical_name")),
        aliases=_text_list(grounding.get("aliases")),
        seq=event.seq,
    )


def _ledger_scope_query(*, book_id: int, book_run_id: int | None) -> Any:
    query = select(StoryStateLedger).where(StoryStateLedger.book_id == book_id)
    if book_run_id is None:
        return query.where(StoryStateLedger.book_run_id.is_(None))
    return query.where(StoryStateLedger.book_run_id == book_run_id)


def _event_scope_query(*, book_id: int, book_run_id: int | None) -> Any:
    query = select(StoryStateEvent).where(StoryStateEvent.book_id == book_id)
    if book_run_id is None:
        return query.where(StoryStateEvent.book_run_id.is_(None))
    return query.where(StoryStateEvent.book_run_id == book_run_id)


def _canonical_name(change: StateChangeInput, fallback: str) -> str:
    return _text_value(change.canonical_name) or fallback or change.entity_id


def _merged_aliases(existing: Sequence[object], change: StateChangeInput) -> list[str]:
    return _clean_strings([*existing, *change.aliases, change.canonical_name])


def _first_text(payload: Mapping[str, object], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = _text_value(payload.get(key))
        if value is not None:
            return value
    return None


def _positive_int(value: object) -> int | None:
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if parsed > 0 else None
    return None


def _text_value(value: object) -> str | None:
    if isinstance(value, str):
        normalized = value.strip()
        if normalized:
            return normalized
    return None


def _text_list(value: object) -> list[str]:
    if isinstance(value, str):
        return _clean_strings([value])
    if isinstance(value, Sequence) and not isinstance(value, bytes | bytearray):
        return _clean_strings(value)
    return []


def _clean_strings(values: Sequence[object]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _normalized_key(value: str) -> str:
    return value.strip().lower()
