from __future__ import annotations

import json

from sqlalchemy.orm import Session

from app.domains.books.models import Book, Chapter
from app.domains.story_memory.atoms import create_memory_atom, list_memory_atoms
from app.domains.story_memory.errors import (
    ForeshadowLifecycleConflictError,
    ForeshadowLifecycleTransitionError,
    StoryMemoryInputError,
)
from app.domains.story_memory.schemas import (
    ForeshadowLifecycleSnapshot,
    ForeshadowLifecycleState,
    ForeshadowLifecycleTransition,
    MemoryAtom,
)

_FORESHADOW_ENTITY_TYPE = "subplot"
_FORESHADOW_FACT_TYPE = "plot_thread"
_FORESHADOW_LIFECYCLE_KIND = "foreshadow_lifecycle"
_FORESHADOW_ALLOWED_TRANSITIONS: dict[str | None, set[str]] = {
    None: {"planted"},
    "planted": {"reinforced", "abandoned"},
    "reinforced": {"reinforced", "paid_off", "abandoned"},
    "paid_off": set(),
    "abandoned": set(),
}


def apply_foreshadow_lifecycle_transition(
    session: Session,
    payload: ForeshadowLifecycleTransition,
) -> ForeshadowLifecycleSnapshot:
    """按状态机推进伏笔生命周期，并用 plot_thread 记忆事实保留转换历史。"""

    chapter = _require_lifecycle_refs(session, payload)
    history = list_foreshadow_lifecycle(session, payload.novel_id, payload.foreshadow_id)
    latest = history[-1] if history else None
    requested_state = payload.target_state
    target_state, degraded, reason = _resolve_foreshadow_target(payload)
    _ensure_foreshadow_transition_allowed(latest, target_state, requested_state)
    revision = 1 if latest is None else latest.revision + 1
    snapshot = ForeshadowLifecycleSnapshot(
        memory_id=f"foreshadow:{payload.foreshadow_id}:{revision}",
        novel_id=payload.novel_id,
        foreshadow_id=payload.foreshadow_id,
        state=target_state,  # type: ignore[arg-type]
        requested_state=requested_state,
        chapter_id=payload.chapter_id,
        volume_id=payload.volume_id,
        evidence_refs=list(payload.evidence_refs),
        transition_reason=reason,
        revision=revision,
        degraded=degraded,
    )
    atom = create_memory_atom(
        session,
        MemoryAtom(
            memory_id=snapshot.memory_id,
            novel_id=payload.novel_id,
            entity_type=_FORESHADOW_ENTITY_TYPE,  # type: ignore[arg-type]
            entity_id=payload.foreshadow_id,
            fact_type=_FORESHADOW_FACT_TYPE,  # type: ignore[arg-type]
            value=_dump_lifecycle_snapshot(snapshot),
            source_ref=_foreshadow_source_ref(payload),
            source_chapter_id=payload.chapter_id,
            valid_from_chapter=chapter.ordinal,
            confidence=0.6 if degraded else 1.0,
            revision=revision,
        ),
    )
    return snapshot.model_copy(update={"memory_id": atom.memory_id})


def list_foreshadow_lifecycle(
    session: Session,
    book_id: int,
    foreshadow_id: str,
) -> list[ForeshadowLifecycleSnapshot]:
    """读取同一伏笔的生命周期快照历史，忽略非生命周期 plot_thread 事实。"""

    snapshots: list[ForeshadowLifecycleSnapshot] = []
    for atom in list_memory_atoms(
        session,
        book_id=book_id,
        entity_type=_FORESHADOW_ENTITY_TYPE,
        entity_id=foreshadow_id,
        fact_type=_FORESHADOW_FACT_TYPE,
    ):
        snapshot = _load_lifecycle_snapshot(atom)
        if snapshot is not None:
            snapshots.append(snapshot)
    return sorted(snapshots, key=lambda item: (item.revision, item.memory_id))


def _require_lifecycle_refs(session: Session, payload: ForeshadowLifecycleTransition) -> Chapter:
    if session.get(Book, payload.novel_id) is None:
        raise StoryMemoryInputError("作品不存在，无法推进伏笔生命周期。")
    chapter = session.get(Chapter, payload.chapter_id)
    if chapter is None or chapter.book_id != payload.novel_id:
        raise StoryMemoryInputError("章节不存在或不属于当前作品，无法推进伏笔生命周期。")
    return chapter


def _resolve_foreshadow_target(payload: ForeshadowLifecycleTransition) -> tuple[str, bool, str]:
    if payload.target_state != "paid_off" or payload.evidence_refs:
        return payload.target_state, False, payload.transition_reason
    return "abandoned", True, f"{payload.transition_reason} 缺少证据，已降级为 abandoned。"


def _ensure_foreshadow_transition_allowed(
    latest: ForeshadowLifecycleSnapshot | None,
    target_state: str,
    requested_state: ForeshadowLifecycleState,
) -> None:
    current_state = latest.state if latest is not None else None
    if latest is not None and current_state in {"paid_off", "abandoned"}:
        raise ForeshadowLifecycleConflictError(f"伏笔 {latest.foreshadow_id} 已经处于 {current_state}，不能重复转换。")
    allowed = _FORESHADOW_ALLOWED_TRANSITIONS[current_state]
    if target_state not in allowed:
        raise ForeshadowLifecycleTransitionError(f"不允许从 {current_state or '未开始'} 转换到 {requested_state}。")


def _dump_lifecycle_snapshot(snapshot: ForeshadowLifecycleSnapshot) -> str:
    data = snapshot.model_dump()
    data["kind"] = _FORESHADOW_LIFECYCLE_KIND
    return json.dumps(data, ensure_ascii=False, sort_keys=True)


def _load_lifecycle_snapshot(atom: MemoryAtom) -> ForeshadowLifecycleSnapshot | None:
    try:
        data = json.loads(atom.value)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or data.get("kind") != _FORESHADOW_LIFECYCLE_KIND:
        return None
    data["memory_id"] = atom.memory_id
    return ForeshadowLifecycleSnapshot.model_validate(data)


def _foreshadow_source_ref(payload: ForeshadowLifecycleTransition) -> str:
    if payload.source_ref is not None:
        return payload.source_ref
    if payload.evidence_refs:
        return payload.evidence_refs[0][:255]
    return f"chapter:{payload.chapter_id}"
