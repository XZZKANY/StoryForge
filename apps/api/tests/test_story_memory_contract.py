from __future__ import annotations

import pytest

from app.domains.story_memory.schemas import AgentProposal, MemoryAtom, Progression
from app.domains.story_memory.service import arbitrate_proposal, atoms_active_at_chapter, detect_memory_conflicts


def test_memory_atoms_support_chapter_scoped_progression() -> None:
    """同一角色状态可以随章节演化，查询时只返回当前章节有效事实。"""

    atoms = [
        MemoryAtom(
            memory_id="m1",
            novel_id=1,
            entity_type="character",
            entity_id="linlan",
            fact_type="appearance",
            value="左臂完好",
            source_ref="chapter:1",
            valid_from_chapter=1,
            valid_to_chapter=4,
        ),
        MemoryAtom(
            memory_id="m2",
            novel_id=1,
            entity_type="character",
            entity_id="linlan",
            fact_type="appearance",
            value="左臂有旧伤",
            source_ref="chapter:5",
            valid_from_chapter=5,
        ),
    ]
    progression = Progression(
        progression_id="p1",
        novel_id=1,
        entity_id="linlan",
        fact_type="appearance",
        atoms=atoms,
    )

    assert [atom.value for atom in atoms_active_at_chapter(progression.atoms, 3)] == ["左臂完好"]
    assert [atom.value for atom in atoms_active_at_chapter(progression.atoms, 8)] == ["左臂有旧伤"]


def test_memory_conflict_detection_flags_overlapping_different_values() -> None:
    """重叠章节区间的不同事实值必须生成冲突报告。"""

    atoms = [
        MemoryAtom(
            memory_id="m-left",
            novel_id=1,
            entity_type="character",
            entity_id="linlan",
            fact_type="status",
            value="公开身份是机械师",
            source_ref="chapter:2",
            valid_from_chapter=2,
            valid_to_chapter=8,
            immutable=True,
        ),
        MemoryAtom(
            memory_id="m-right",
            novel_id=1,
            entity_type="character",
            entity_id="linlan",
            fact_type="status",
            value="公开身份是舰队指挥官",
            source_ref="chapter:4",
            valid_from_chapter=4,
            valid_to_chapter=6,
        ),
        MemoryAtom(
            memory_id="m-other",
            novel_id=1,
            entity_type="character",
            entity_id="linlan",
            fact_type="relationship",
            value="信任副官",
            source_ref="chapter:4",
            valid_from_chapter=4,
        ),
    ]

    conflicts = detect_memory_conflicts(atoms)

    assert len(conflicts) == 1
    assert conflicts[0].severity == "blocking"
    assert conflicts[0].left_memory_id == "m-left"
    assert conflicts[0].right_memory_id == "m-right"
    assert "重叠章节区间" in conflicts[0].reason


def test_arbitrator_blocks_high_risk_agent_proposal() -> None:
    """Agent 提案遇到高风险事实冲突时只能进入人工审批。"""

    conflict = detect_memory_conflicts(
        [
            MemoryAtom(
                memory_id="m1",
                novel_id=1,
                entity_type="world_rule",
                entity_id="magic-rule",
                fact_type="rule",
                value="超光速跃迁需要灯塔许可",
                source_ref="chapter:1",
                valid_from_chapter=1,
                immutable=True,
            ),
            MemoryAtom(
                memory_id="m2",
                novel_id=1,
                entity_type="world_rule",
                entity_id="magic-rule",
                fact_type="rule",
                value="超光速跃迁无需任何许可",
                source_ref="draft:agent",
                valid_from_chapter=3,
            ),
        ]
    )
    proposal = AgentProposal(
        proposal_id="proposal-1",
        run_id="run-1",
        agent_name="plot_agent",
        target_type="memory",
        target_id="magic-rule",
        target_revision=1,
        operation="update",
        diff={"value": "超光速跃迁无需任何许可"},
        evidence_ids=["draft:agent"],
        severity="high",
        confidence=0.8,
    )

    decision = arbitrate_proposal(proposal, conflict)

    assert decision.decision == "needs_human"
    assert decision.blocked_by_conflict_ids == [conflict[0].conflict_id]


def test_progression_rejects_mixed_entities() -> None:
    """Progression 必须只描述同一实体同一事实类型，避免动态故事百科变成杂物箱。"""

    with pytest.raises(ValueError, match="同一实体"):
        Progression(
            progression_id="bad",
            novel_id=1,
            entity_id="linlan",
            fact_type="appearance",
            atoms=[
                MemoryAtom(
                    memory_id="m1",
                    novel_id=1,
                    entity_type="character",
                    entity_id="linlan",
                    fact_type="appearance",
                    value="左臂完好",
                    source_ref="chapter:1",
                ),
                MemoryAtom(
                    memory_id="m2",
                    novel_id=1,
                    entity_type="character",
                    entity_id="deputy",
                    fact_type="appearance",
                    value="戴黑色手套",
                    source_ref="chapter:1",
                ),
            ],
        )
