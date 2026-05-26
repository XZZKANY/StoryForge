from __future__ import annotations

from hashlib import sha1

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.common.exceptions import InputError
from app.domains.books.models import Book
from app.domains.story_memory.models import MemoryAtomRecord
from app.domains.story_memory.schemas import (
    AgentProposal,
    ArbitrationDecision,
    MemoryAtom,
    MemoryConflict,
)


class StoryMemoryInputError(InputError):
    """长效记忆输入引用不存在或区间非法时抛出。"""


def create_memory_atom(session: Session, payload: MemoryAtom) -> MemoryAtom:
    """创建长效记忆事实，并返回契约对象。"""

    if session.get(Book, payload.novel_id) is None:
        raise StoryMemoryInputError("作品不存在，无法写入长效记忆。")
    record = MemoryAtomRecord(
        book_id=payload.novel_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        fact_type=payload.fact_type,
        value=payload.value,
        valid_from_chapter=payload.valid_from_chapter,
        valid_to_chapter=payload.valid_to_chapter,
        immutable=payload.immutable,
        confidence=payload.confidence,
        revision=payload.revision,
        source_ref=payload.source_ref,
    )
    session.add(record)
    session.commit()
    session.refresh(record)
    return _record_to_atom(record)


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
    records = session.scalars(
        statement.order_by(MemoryAtomRecord.entity_type, MemoryAtomRecord.entity_id, MemoryAtomRecord.fact_type, MemoryAtomRecord.id)
    ).all()
    return [_record_to_atom(record) for record in records]


def get_active_memory_atoms(
    session: Session,
    *,
    book_id: int,
    chapter_id: int,
    entity_type: str | None = None,
    entity_id: str | None = None,
    fact_type: str | None = None,
) -> list[MemoryAtom]:
    """从数据库读取指定章节有效的长效记忆事实。"""

    return [
        atom
        for atom in list_memory_atoms(
            session,
            book_id=book_id,
            entity_type=entity_type,
            entity_id=entity_id,
            fact_type=fact_type,
        )
        if _is_active(atom, chapter_id)
    ]


def atoms_active_at_chapter(atoms: list[MemoryAtom], chapter_id: int) -> list[MemoryAtom]:
    """按章节读取有效事实，避免后期设定覆盖前期状态。"""

    return [atom for atom in atoms if _is_active(atom, chapter_id)]


def detect_memory_conflicts(atoms: list[MemoryAtom]) -> list[MemoryConflict]:
    """检测同一实体同一事实类型在重叠章节区间的矛盾。"""

    conflicts: list[MemoryConflict] = []
    ordered_atoms = sorted(atoms, key=lambda atom: (atom.entity_id, atom.fact_type, atom.valid_from_chapter, atom.memory_id))
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
            valid_from_chapter=int(diff.get("valid_from_chapter", 1) or 1),
            valid_to_chapter=int(diff["valid_to_chapter"]) if diff.get("valid_to_chapter") is not None else None,
            immutable=bool(diff.get("immutable", False)),
            confidence=float(diff.get("confidence", proposal.confidence) or proposal.confidence),
            revision=int(diff.get("revision", proposal.target_revision) or proposal.target_revision),
        ),
    )


def _is_active(atom: MemoryAtom, chapter_id: int) -> bool:
    if chapter_id < atom.valid_from_chapter:
        return False
    return atom.valid_to_chapter is None or chapter_id <= atom.valid_to_chapter


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
        valid_from_chapter=record.valid_from_chapter,
        valid_to_chapter=record.valid_to_chapter,
        confidence=record.confidence,
        immutable=record.immutable,
        revision=record.revision,
    )
