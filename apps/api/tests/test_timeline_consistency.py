from __future__ import annotations

from sqlalchemy.orm import Session
from test_judge_timeline_consistency import _seed_scene

from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import create_judge_issues
from app.domains.story_memory.models import MemoryAtomRecord


def test_timeline_consistency_gate_rejects_dead_character_appearance(session: Session) -> None:
    """Phase 9C Timeline 门禁：已死亡角色不能在后续正文出场。"""

    scene, packet, book = _seed_scene(session)
    session.add(
        MemoryAtomRecord(
            book_id=book.id,
            entity_type="character",
            entity_id="林岚",
            fact_type="status",
            value="林岚已死亡",
            valid_from_chapter=1,
            valid_to_chapter=None,
            immutable=True,
            confidence=0.99,
            revision=1,
            source_ref="chapter:1",
        )
    )
    session.commit()

    issues = create_judge_issues(
        session,
        JudgeIssueCreate(
            scene_id=scene.id,
            scene_packet_id=packet.id,
            content="林岚走进雾港码头，向守夜人点头。",
            required_facts=[],
            style_rules=[],
            evidence_links=[],
        ),
    )

    issue = next(item for item in issues if item.issue_type == "timeline_conflict")
    assert issue.severity == "high"
    assert issue.payload["violation"]["type"] == "dead_character_appears"
    assert issue.payload["violation"]["entity_id"] == "林岚"
