from __future__ import annotations

from hashlib import sha1

from sqlalchemy.orm import Session

from app.domains.story_memory.atoms import create_memory_atom
from app.domains.story_memory.errors import StoryMemoryInputError
from app.domains.story_memory.schemas import AgentProposal, ArbitrationDecision, MemoryAtom, MemoryConflict


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
