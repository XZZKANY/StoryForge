from __future__ import annotations

import json
import logging
import os
from collections.abc import Mapping
from hashlib import sha1

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.common.exceptions import ConflictError, InputError
from app.domains.assets.models import Asset
from app.domains.books.models import Book, Chapter
from app.domains.continuity.models import ContinuityRecord
from app.domains.retrieval.embedding_client import EmbeddingClient
from app.domains.retrieval.pgvector import PGVECTOR_ENGAGED, evaluate_pgvector_decision, pgvector_dimensions
from app.domains.retrieval.service import _cosine_similarity
from app.domains.story_memory.models import MemoryAtomRecord
from app.domains.story_memory.schemas import (
    AgentProposal,
    ArbitrationDecision,
    ForeshadowLifecycleSnapshot,
    ForeshadowLifecycleState,
    ForeshadowLifecycleTransition,
    MemoryAtom,
    MemoryConflict,
)

logger = logging.getLogger(__name__)


class StoryMemoryInputError(InputError):
    """长效记忆输入引用不存在或区间非法时抛出。"""


class ForeshadowLifecycleTransitionError(InputError):
    """伏笔生命周期转换不符合状态机时抛出。"""


class ForeshadowLifecycleConflictError(ConflictError):
    """伏笔生命周期已处于终态或重复转换时抛出。"""


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
DEFAULT_MEMORY_PGVECTOR_DIMENSIONS = 1536
DEFAULT_MEMORY_VECTOR_CANDIDATE_MULTIPLIER = 8
DEFAULT_MEMORY_VECTOR_MIN_CANDIDATES = 32


def create_memory_atom(
    session: Session,
    payload: MemoryAtom,
    *,
    embedding_client: EmbeddingClient | None = None,
) -> MemoryAtom:
    """创建长效记忆事实，并返回契约对象。"""

    if session.get(Book, payload.novel_id) is None:
        raise StoryMemoryInputError("作品不存在，无法写入长效记忆。")
    if payload.source_chapter_id is not None:
        chapter = session.get(Chapter, payload.source_chapter_id)
        if chapter is None or chapter.book_id != payload.novel_id:
            raise StoryMemoryInputError("章节来源不存在或不属于当前作品，无法写入长效记忆。")
    record = MemoryAtomRecord(
        book_id=payload.novel_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        fact_type=payload.fact_type,
        value=payload.value,
        source_chapter_id=payload.source_chapter_id,
        valid_from_chapter=payload.valid_from_chapter,
        valid_to_chapter=payload.valid_to_chapter,
        immutable=payload.immutable,
        confidence=payload.confidence,
        revision=payload.revision,
        embedding=_memory_atom_embedding(payload, embedding_client),
        source_ref=payload.source_ref,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return _record_to_atom(record)


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


def list_memory_atoms(
    session: Session,
    *,
    book_id: int,
    entity_type: str | None = None,
    entity_id: str | None = None,
    fact_type: str | None = None,
) -> list[MemoryAtom]:
    """按作品和可选实体条件列出长效记忆事实。"""

    statement = select(MemoryAtomRecord).where(MemoryAtomRecord.book_id == book_id)
    if entity_type is not None:
        statement = statement.where(MemoryAtomRecord.entity_type == entity_type)
    if entity_id is not None:
        statement = statement.where(MemoryAtomRecord.entity_id == entity_id)
    if fact_type is not None:
        statement = statement.where(MemoryAtomRecord.fact_type == fact_type)
    records = session.scalars(_memory_atom_default_order(statement)).all()
    return [_record_to_atom(record) for record in records]


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


def get_active_memory_atoms(
    session: Session,
    *,
    book_id: int,
    chapter_ordinal: int,
    entity_type: str | None = None,
    entity_id: str | None = None,
    fact_type: str | None = None,
) -> list[MemoryAtom]:
    """从数据库读取指定章节序号有效的长效记忆事实。

    Phase 2 修复：参数改名为 chapter_ordinal，明确语义为章节序号（1,2,3...）。
    """

    return [
        atom
        for atom in list_memory_atoms(
            session,
            book_id=book_id,
            entity_type=entity_type,
            entity_id=entity_id,
            fact_type=fact_type,
        )
        if _is_active(atom, chapter_ordinal)
    ]


def atoms_active_at_chapter(atoms: list[MemoryAtom], chapter_ordinal: int) -> list[MemoryAtom]:
    """按章节序号读取有效事实，避免后期设定覆盖前期状态。

    Phase 2 修复：参数改名为 chapter_ordinal，明确语义。
    """

    return [atom for atom in atoms if _is_active(atom, chapter_ordinal)]


def recall_scene_memory_atoms(
    session: Session,
    *,
    book_id: int,
    chapter: Chapter,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
    embedding_client: EmbeddingClient | None = None,
    limit: int = 12,
) -> list[MemoryAtom]:
    """按 POV、地点、活跃角色和前章约束召回当前场景需要的长效记忆。"""

    candidate_terms = _scene_memory_terms(chapter, assets, continuity_records)
    query_embedding = _memory_query_embedding(candidate_terms, embedding_client)
    active_atoms = _get_active_memory_atom_candidates(
        session,
        book_id=book_id,
        chapter_ordinal=chapter.ordinal,
        query_embedding=query_embedding,
        limit=limit,
    )
    if not active_atoms:
        return []
    scored = _score_scene_memory_atoms(active_atoms, candidate_terms, chapter, embedding_client, query_embedding)
    return [atom for _, atom in sorted(scored, key=_memory_recall_sort_key)[:limit]]


def detect_memory_conflicts(atoms: list[MemoryAtom]) -> list[MemoryConflict]:
    """检测同一实体同一事实类型在重叠章节区间的矛盾。"""

    conflicts: list[MemoryConflict] = []
    ordered_atoms = sorted(
        atoms, key=lambda atom: (atom.entity_id, atom.fact_type, atom.valid_from_chapter, atom.memory_id)
    )
    for index, left in enumerate(ordered_atoms):
        for right in ordered_atoms[index + 1 :]:
            if left.entity_id != right.entity_id or left.fact_type != right.fact_type:
                continue
            if not _ranges_overlap(left, right) or left.value == right.value:
                continue
            conflicts.append(_build_conflict(left, right))
    return conflicts


def arbitrate_proposal(proposal: AgentProposal, conflicts: list[MemoryConflict]) -> ArbitrationDecision:
    """按冲突严重度仲裁 Agent 提案，阻止 Agent 绕过真相源写入。"""

    blocking_conflicts = [conflict for conflict in conflicts if conflict.severity in {"high", "blocking"}]
    if proposal.severity == "blocking" or blocking_conflicts:
        return ArbitrationDecision(
            proposal_id=proposal.proposal_id,
            decision="needs_human",
            reason="提案涉及高风险事实或阻塞冲突，必须人工确认后写入真相源。",
            blocked_by_conflict_ids=[conflict.conflict_id for conflict in blocking_conflicts],
        )
    if proposal.confidence < 0.5:
        return ArbitrationDecision(
            proposal_id=proposal.proposal_id,
            decision="reject",
            reason="提案置信度过低，拒绝写入真相源。",
        )
    return ArbitrationDecision(
        proposal_id=proposal.proposal_id,
        decision="auto_merge",
        reason="提案无高风险冲突且置信度达标，可进入自动合并流程。",
    )


def apply_arbitration_decision(
    session: Session,
    proposal: AgentProposal,
    decision: ArbitrationDecision,
) -> MemoryAtom | None:
    """执行最小仲裁闭环：只有 auto_merge 的 memory create 提案会写入真相源。"""

    if decision.decision != "auto_merge" or proposal.target_type != "memory" or proposal.operation != "create":
        return None
    diff = proposal.diff
    required_keys = {"book_id", "entity_type", "entity_id", "fact_type", "value", "source_ref"}
    missing_keys = sorted(required_keys - set(diff))
    if missing_keys:
        raise StoryMemoryInputError(f"自动合并提案缺少字段：{', '.join(missing_keys)}。")
    return create_memory_atom(
        session,
        MemoryAtom(
            memory_id=proposal.proposal_id,
            novel_id=int(diff["book_id"]),
            entity_type=str(diff["entity_type"]),  # type: ignore[arg-type]
            entity_id=str(diff["entity_id"]),
            fact_type=str(diff["fact_type"]),  # type: ignore[arg-type]
            value=str(diff["value"]),
            source_ref=str(diff["source_ref"]),
            source_chapter_id=int(diff["source_chapter_id"]) if diff.get("source_chapter_id") is not None else None,
            valid_from_chapter=int(diff.get("valid_from_chapter", 1) or 1),
            valid_to_chapter=int(diff["valid_to_chapter"]) if diff.get("valid_to_chapter") is not None else None,
            immutable=bool(diff.get("immutable", False)),
            confidence=float(diff.get("confidence", proposal.confidence) or proposal.confidence),
            revision=int(diff.get("revision", proposal.target_revision) or proposal.target_revision),
        ),
    )


def write_memory_extract_atoms(
    session: Session,
    *,
    book_id: int,
    chapter_id: int,
    approved_scene_id: int,
    extraction: Mapping[str, object],
) -> list[MemoryAtom]:
    """把 memory_extract 的白名单抽取结果写入 Story Memory。"""

    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.book_id != book_id:
        raise StoryMemoryInputError("章节来源不存在或不属于当前作品，无法写入长效记忆。")
    if session.get(Book, book_id) is None:
        raise StoryMemoryInputError("作品不存在，无法写入长效记忆。")
    if approved_scene_id <= 0:
        raise StoryMemoryInputError("批准场景引用无效，无法写入长效记忆。")

    atoms: list[MemoryAtom] = []
    for payload in _memory_extract_atom_payloads(
        book_id=book_id,
        chapter=chapter,
        approved_scene_id=approved_scene_id,
        extraction=extraction,
    ):
        atoms.append(create_memory_atom(session, payload))
    return atoms


def _memory_extract_atom_payloads(
    *,
    book_id: int,
    chapter: Chapter,
    approved_scene_id: int,
    extraction: Mapping[str, object],
) -> list[MemoryAtom]:
    atoms: list[MemoryAtom] = []
    _append_chapter_summary_atom(atoms, book_id, chapter, approved_scene_id, extraction.get("chapter_summary"))
    _append_collection_atoms(
        atoms,
        book_id=book_id,
        chapter=chapter,
        approved_scene_id=approved_scene_id,
        kind="character_state",
        raw_items=extraction.get("character_states"),
        entity_type="character",
        fact_type="status",
        entity_keys=("entity_id", "character_id", "name", "character"),
        value_keys=("status", "state", "value", "summary"),
    )
    _append_collection_atoms(
        atoms,
        book_id=book_id,
        chapter=chapter,
        approved_scene_id=approved_scene_id,
        kind="world_fact",
        raw_items=extraction.get("world_facts"),
        entity_type="world_rule",
        fact_type="rule",
        entity_keys=("entity_id", "rule_id", "name", "title"),
        value_keys=("rule", "fact", "value", "summary"),
    )
    _append_collection_atoms(
        atoms,
        book_id=book_id,
        chapter=chapter,
        approved_scene_id=approved_scene_id,
        kind="foreshadow_ref",
        raw_items=extraction.get("foreshadow_refs"),
        entity_type="subplot",
        fact_type="plot_thread",
        entity_keys=("entity_id", "thread_id", "name", "title"),
        value_keys=("value", "summary", "ref", "status"),
    )
    return atoms


def _append_chapter_summary_atom(
    atoms: list[MemoryAtom],
    book_id: int,
    chapter: Chapter,
    approved_scene_id: int,
    raw_summary: object,
) -> None:
    item: Mapping[str, object] = raw_summary if isinstance(raw_summary, Mapping) else {"summary": raw_summary}
    value = _first_text(item, ("summary", "value", "text"))
    if value is None:
        return
    entity_id = _first_text(item, ("entity_id",)) or f"chapter:{chapter.ordinal}"
    atoms.append(
        _memory_extract_atom(
            book_id=book_id,
            chapter=chapter,
            approved_scene_id=approved_scene_id,
            kind="chapter_summary",
            index=1,
            entity_type="subplot",
            entity_id=entity_id,
            fact_type="plot_thread",
            value=value,
            confidence=_confidence(item),
            immutable=_bool_value(item.get("immutable")),
        )
    )


def _append_collection_atoms(
    atoms: list[MemoryAtom],
    *,
    book_id: int,
    chapter: Chapter,
    approved_scene_id: int,
    kind: str,
    raw_items: object,
    entity_type: str,
    fact_type: str,
    entity_keys: tuple[str, ...],
    value_keys: tuple[str, ...],
) -> None:
    for index, item in enumerate(_mapping_items(raw_items), start=1):
        entity_id = _first_text(item, entity_keys)
        value = _first_text(item, value_keys)
        if entity_id is None or value is None:
            continue
        atoms.append(
            _memory_extract_atom(
                book_id=book_id,
                chapter=chapter,
                approved_scene_id=approved_scene_id,
                kind=kind,
                index=index,
                entity_type=entity_type,
                entity_id=entity_id,
                fact_type=fact_type,
                value=value,
                confidence=_confidence(item),
                immutable=_bool_value(item.get("immutable")),
                valid_to_chapter=_optional_positive_int(item.get("valid_to_chapter")),
            )
        )


def _memory_extract_atom(
    *,
    book_id: int,
    chapter: Chapter,
    approved_scene_id: int,
    kind: str,
    index: int,
    entity_type: str,
    entity_id: str,
    fact_type: str,
    value: str,
    confidence: float,
    immutable: bool,
    valid_to_chapter: int | None = None,
) -> MemoryAtom:
    return MemoryAtom(
        memory_id=f"memory_extract:{chapter.id}:{kind}:{index}",
        novel_id=book_id,
        entity_type=entity_type,  # type: ignore[arg-type]
        entity_id=entity_id,
        fact_type=fact_type,  # type: ignore[arg-type]
        value=value,
        source_ref=f"chapter:{chapter.id}#approved_scene:{approved_scene_id}#memory_extract:{kind}:{index}",
        source_chapter_id=chapter.id,
        valid_from_chapter=chapter.ordinal,
        valid_to_chapter=valid_to_chapter,
        confidence=confidence,
        immutable=immutable,
    )


def _mapping_items(value: object) -> list[Mapping[str, object]]:
    if isinstance(value, Mapping):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, Mapping)]
    return []


def _first_text(item: Mapping[str, object], keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = item.get(key)
        if isinstance(value, str):
            normalized = value.strip()
            if normalized:
                return normalized
    return None


def _confidence(item: Mapping[str, object]) -> float:
    value = item.get("confidence")
    if isinstance(value, int | float):
        return min(1.0, max(0.0, float(value)))
    return 1.0


def _bool_value(value: object) -> bool:
    return value if isinstance(value, bool) else False


def _optional_positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and value > 0 else None


def _scene_memory_terms(
    chapter: Chapter,
    assets: list[Asset],
    continuity_records: list[ContinuityRecord],
) -> list[str]:
    terms: list[str] = []
    for value in (chapter.pov, chapter.location, chapter.summary):
        _append_term(terms, value)
    for asset in assets:
        if asset.asset_type == "character":
            _append_term(terms, asset.name)
        for raw_value in asset.payload.values():
            if isinstance(raw_value, str):
                _append_term(terms, raw_value)
            elif isinstance(raw_value, list):
                for item in raw_value:
                    _append_term(terms, str(item))
    for record in continuity_records:
        raw_value = record.payload.get("value")
        if isinstance(raw_value, list):
            for item in raw_value:
                _append_term(terms, str(item))
        elif raw_value is not None:
            _append_term(terms, str(raw_value))
    return terms


def _append_term(terms: list[str], value: str | None) -> None:
    if value is None:
        return
    normalized = value.strip()
    if normalized and normalized not in terms:
        terms.append(normalized)


def _memory_atom_matches_scene(atom: MemoryAtom, candidate_terms: list[str]) -> bool:
    haystack = f"{atom.entity_id} {atom.value} {atom.source_ref}"
    return any(term in haystack or atom.entity_id in term for term in candidate_terms)


def _get_active_memory_atom_candidates(
    session: Session,
    *,
    book_id: int,
    chapter_ordinal: int,
    query_embedding: list[float] | None,
    limit: int,
) -> list[MemoryAtom]:
    statement = select(MemoryAtomRecord).where(
        MemoryAtomRecord.book_id == book_id,
        MemoryAtomRecord.valid_from_chapter <= chapter_ordinal,
        (MemoryAtomRecord.valid_to_chapter.is_(None) | (MemoryAtomRecord.valid_to_chapter >= chapter_ordinal)),
    )
    records = _load_memory_atom_candidates(
        session,
        statement,
        query_embedding=query_embedding,
        limit=limit,
    )
    return [_record_to_atom(record) for record in records]


def _load_memory_atom_candidates(
    session: Session,
    statement,
    *,
    query_embedding: list[float] | None = None,
    limit: int | None = None,
) -> list[MemoryAtomRecord]:
    expected_dims = _memory_pgvector_dimensions()
    reason = evaluate_pgvector_decision(session, query_embedding, expected_dims=expected_dims)
    if reason == PGVECTOR_ENGAGED:
        candidate_limit = _memory_vector_candidate_limit(limit)
        vector_statement = _apply_memory_pgvector_candidate_order(statement, candidate_limit)
        records = list(
            session.scalars(vector_statement, {"query_embedding": _pgvector_literal(query_embedding or [])}).all()
        )
        logger.debug("memory pgvector 召回已启用：candidate_limit=%s got=%s", candidate_limit, len(records))
        return records
    if query_embedding is not None:
        logger.info(
            "memory pgvector 未启用，回退默认排序召回：reason=%s expected_dims=%s got_dims=%s",
            reason,
            expected_dims,
            len(query_embedding),
        )
    return list(session.scalars(_memory_atom_default_order(statement)).all())


def _memory_atom_default_order(statement):
    return statement.order_by(MemoryAtomRecord.entity_type, MemoryAtomRecord.entity_id, MemoryAtomRecord.fact_type, MemoryAtomRecord.id)


def _memory_pgvector_dimensions() -> int:
    return pgvector_dimensions("STORYFORGE_MEMORY_PGVECTOR_DIMENSIONS", DEFAULT_MEMORY_PGVECTOR_DIMENSIONS)


def _memory_vector_candidate_limit(limit: int | None) -> int:
    multiplier = _positive_int_env(
        "STORYFORGE_MEMORY_VECTOR_CANDIDATE_MULTIPLIER",
        DEFAULT_MEMORY_VECTOR_CANDIDATE_MULTIPLIER,
    )
    min_candidates = _positive_int_env(
        "STORYFORGE_MEMORY_VECTOR_MIN_CANDIDATES",
        DEFAULT_MEMORY_VECTOR_MIN_CANDIDATES,
    )
    if limit is None:
        return min_candidates
    return max(limit * multiplier, min_candidates)


def _positive_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    try:
        value = int(raw_value)
    except ValueError:
        return default
    return value if value > 0 else default


def _pgvector_literal(values: list[float]) -> str:
    return "[" + ",".join(str(float(value)) for value in values) + "]"


def _apply_memory_pgvector_candidate_order(statement, candidate_limit: int):
    distance_order = text("memory_atoms.embedding_vector <=> CAST(:query_embedding AS vector)")
    return statement.order_by(None).order_by(distance_order).limit(candidate_limit)


def _memory_query_embedding(candidate_terms: list[str], embedding_client: EmbeddingClient | None) -> list[float] | None:
    query = " ".join(candidate_terms).strip()
    if embedding_client is None or not query:
        return None
    result = embedding_client.embed_texts([query])
    if not result.vectors:
        return None
    return result.vectors[0]


def _memory_atom_embedding(atom: MemoryAtom, embedding_client: EmbeddingClient | None) -> list[float]:
    if embedding_client is None:
        return []
    result = embedding_client.embed_texts([_memory_atom_embedding_text(atom)])
    if not result.vectors:
        return []
    return result.vectors[0]


MemoryRecallScore = tuple[float, float, float, int, str]


def _score_scene_memory_atoms(
    atoms: list[MemoryAtom],
    candidate_terms: list[str],
    chapter: Chapter,
    embedding_client: EmbeddingClient | None,
    query_embedding: list[float] | None = None,
) -> list[tuple[MemoryRecallScore, MemoryAtom]]:
    semantic_scores = _semantic_memory_scores(atoms, candidate_terms, embedding_client, query_embedding)
    scored: list[tuple[MemoryRecallScore, MemoryAtom]] = []
    for atom in atoms:
        keyword_score = _keyword_memory_score(atom, candidate_terms)
        semantic_score = semantic_scores.get(atom.memory_id, 0.0)
        if keyword_score <= 0 and semantic_score <= 0.25:
            continue
        recency_score = 1.0 / max(1, chapter.ordinal - atom.valid_from_chapter + 1)
        immutable_score = 1.0 if atom.immutable else 0.0
        total = keyword_score + semantic_score + (0.15 * recency_score) + (0.1 * immutable_score)
        scored.append(((total, semantic_score, keyword_score, _term_rank(atom.entity_id, candidate_terms), atom.memory_id), atom))
    return scored


def _semantic_memory_scores(
    atoms: list[MemoryAtom],
    candidate_terms: list[str],
    embedding_client: EmbeddingClient | None,
    query_embedding: list[float] | None = None,
) -> dict[str, float]:
    query = " ".join(candidate_terms).strip()
    if not query:
        return {}
    if query_embedding is None:
        if embedding_client is None:
            return {}
        query_result = embedding_client.embed_texts([query])
        if not query_result.vectors:
            return {}
        query_embedding = query_result.vectors[0]

    scores: dict[str, float] = {}
    missing_atoms: list[MemoryAtom] = []
    for atom in atoms:
        if atom.embedding:
            scores[atom.memory_id] = _cosine_similarity(query_embedding, atom.embedding)
        else:
            missing_atoms.append(atom)
    if not missing_atoms:
        return scores
    if embedding_client is None:
        return scores

    missing_texts = [_memory_atom_embedding_text(atom) for atom in missing_atoms]
    missing_result = embedding_client.embed_texts(missing_texts)
    if len(missing_result.vectors) != len(missing_atoms):
        return scores
    for atom, embedding in zip(missing_atoms, missing_result.vectors, strict=False):
        scores[atom.memory_id] = _cosine_similarity(query_embedding, embedding)
    return scores


def _memory_atom_embedding_text(atom: MemoryAtom) -> str:
    return f"{atom.entity_type} {atom.entity_id} {atom.fact_type} {atom.value}"


def _keyword_memory_score(atom: MemoryAtom, candidate_terms: list[str]) -> float:
    if not _memory_atom_matches_scene(atom, candidate_terms):
        return 0.0
    return 1.0 + (0.25 if _term_rank(atom.entity_id, candidate_terms) < len(candidate_terms) else 0.0)


def _memory_recall_sort_key(item: tuple[MemoryRecallScore, MemoryAtom]) -> tuple[float, float, float, int, str]:
    score, atom = item
    total, semantic_score, keyword_score, term_rank, memory_id = score
    return (-total, -semantic_score, -keyword_score, term_rank, atom.entity_type, atom.fact_type, memory_id)


def _term_rank(entity_id: str, candidate_terms: list[str]) -> int:
    for index, term in enumerate(candidate_terms):
        if entity_id == term or entity_id in term or term in entity_id:
            return index
    return len(candidate_terms)


def _is_active(atom: MemoryAtom, chapter_ordinal: int) -> bool:
    """判断 memory atom 在指定章节序号是否有效。

    Phase 2 修复：统一使用 ordinal（章节序号 1,2,3...）而非 PK（数据库 ID）。
    """
    if chapter_ordinal < atom.valid_from_chapter:
        return False
    return atom.valid_to_chapter is None or chapter_ordinal <= atom.valid_to_chapter


def _ranges_overlap(left: MemoryAtom, right: MemoryAtom) -> bool:
    left_end = left.valid_to_chapter if left.valid_to_chapter is not None else 10**9
    right_end = right.valid_to_chapter if right.valid_to_chapter is not None else 10**9
    return max(left.valid_from_chapter, right.valid_from_chapter) <= min(left_end, right_end)


def _build_conflict(left: MemoryAtom, right: MemoryAtom) -> MemoryConflict:
    severity = "blocking" if left.immutable or right.immutable else "high"
    raw = f"{left.memory_id}|{right.memory_id}|{left.entity_id}|{left.fact_type}"
    return MemoryConflict(
        conflict_id=f"conflict_{sha1(raw.encode('utf-8')).hexdigest()[:12]}",
        novel_id=left.novel_id,
        entity_id=left.entity_id,
        fact_type=left.fact_type,
        left_memory_id=left.memory_id,
        right_memory_id=right.memory_id,
        severity=severity,
        reason="同一实体同一事实类型在重叠章节区间出现不同取值。",
        source_refs=[left.source_ref, right.source_ref],
    )


def _record_to_atom(record: MemoryAtomRecord) -> MemoryAtom:
    return MemoryAtom(
        memory_id=f"memory:{record.id}",
        novel_id=record.book_id,
        entity_type=record.entity_type,  # type: ignore[arg-type]
        entity_id=record.entity_id,
        fact_type=record.fact_type,  # type: ignore[arg-type]
        value=record.value,
        source_ref=record.source_ref,
        source_chapter_id=record.source_chapter_id,
        valid_from_chapter=record.valid_from_chapter,
        valid_to_chapter=record.valid_to_chapter,
        confidence=record.confidence,
        immutable=record.immutable,
        revision=record.revision,
        embedding=list(record.embedding or []),
    )
