from __future__ import annotations

from sqlalchemy.orm import Session

from app.domains.books.models import Book, Chapter, Scene
from app.domains.character_bible.models import CharacterBibleEntry
from app.domains.continuity.models import ScenePacket
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import create_judge_issues


def test_character_bible_guard_gate_flags_forbidden_traits(session: Session) -> None:
    """Phase 9C Character Bible 门禁：禁止特质必须导致角色一致性失败。"""

    book = Book(title="角色规则门禁", status="draft", premise="验证角色禁忌。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="码头", status="draft", summary=None)
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="谈判", status="draft", content=None)
    session.add(scene)
    session.flush()
    packet = ScenePacket(scene_id=scene.id, status="assembled", packet={"必须包含事实": [], "风格规则": []}, version=1)
    session.add(packet)
    session.add(
        CharacterBibleEntry(
            book_id=book.id,
            character_id=None,
            canonical_name="林岚",
            aliases=["林调查员"],
            voice_traits={"语气": "克制"},
            forbidden_traits={"禁止": ["突然健谈"]},
        )
    )
    session.commit()
    issues = create_judge_issues(
        session,
        JudgeIssueCreate(
            scene_id=scene.id,
            scene_packet_id=packet.id,
            content="林岚突然健谈，解释了所有计划。",
            required_facts=[],
            style_rules=[],
            evidence_links=[],
        ),
    )

    issue = next(item for item in issues if item.issue_type == "character_consistency")
    assert issue.severity == "high"
    assert issue.payload["consistency_dimensions"] == {
        "character_consistency": "fail",
        "world_consistency": "pass",
    }
    assert issue.payload["violation"]["forbidden_trait"] == "突然健谈"
