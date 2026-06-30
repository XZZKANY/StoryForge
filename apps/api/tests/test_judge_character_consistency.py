from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.books.models import Book, Chapter, Scene
from app.domains.character_bible.models import CharacterBibleEntry
from app.domains.continuity.models import ScenePacket
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import create_judge_issues
from app.domains.repair.schemas import RepairPatchCreate
from app.domains.repair.service import create_repair_patch


def test_judge_fails_for_character_bible_forbidden_traits_and_repair_clears_violation(session: Session) -> None:
    """正文违反 Character Bible 禁止特质时，Judge 必须失败且 Repair 后可重评通过。"""

    book = Book(title="雾港角色一致性", status="draft", premise="验证角色硬规则。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="旧伤谈判", status="draft", summary=None)
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="码头", status="draft", content=None)
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
            forbidden_traits={"禁止": ["突然健谈"], "替换": {"突然健谈": "短促回答"}},
        )
    )
    session.commit()

    content = "林岚突然健谈，向所有人解释自己的计划。"
    issues = create_judge_issues(
        session,
        JudgeIssueCreate(
            scene_id=scene.id,
            scene_packet_id=packet.id,
            content=content,
            required_facts=[],
            style_rules=[],
            evidence_links=[],
        ),
    )

    consistency_issue = next(issue for issue in issues if issue.issue_type == "character_consistency")
    assert consistency_issue.severity == "high"
    assert "林岚" in consistency_issue.description
    assert consistency_issue.payload["consistency_dimensions"] == {
        "character_consistency": "fail",
        "world_consistency": "pass",
    }
    assert consistency_issue.payload["violation"]["forbidden_trait"] == "突然健谈"
    assert consistency_issue.payload["violation"]["canonical_name"] == "林岚"
    assert consistency_issue.payload["matched_text"] == "突然健谈"
    assert consistency_issue.payload["replacement_text"] == "短促回答"

    patch = create_repair_patch(session, RepairPatchCreate(issue_id=consistency_issue.id, content=content))
    repaired_content = content.replace(patch.patch["target_span"], patch.patch["replacement_text"])
    rejudge_issues = create_judge_issues(
        session,
        JudgeIssueCreate(
            scene_id=scene.id,
            scene_packet_id=packet.id,
            content=repaired_content,
            required_facts=[],
            style_rules=[],
            evidence_links=[],
        ),
    )

    assert patch.patch["target_span"] == "突然健谈"
    assert patch.patch["replacement_text"] == "短促回答"
    assert "角色一致性" in (patch.rationale or "")
    assert all(issue.issue_type != "character_consistency" for issue in rejudge_issues)


def test_judge_flags_unregistered_character_addressing_drift(session: Session) -> None:
    """同句中 canonical 角色被未登记称谓替换时，应输出称谓一致性问题。"""

    book = Book(title="称谓一致性", status="draft", premise="验证人物称谓漂移。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=3, title="问询", status="draft", summary=None)
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="问询", status="draft", content=None)
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
            voice_traits={},
            forbidden_traits={},
        )
    )
    session.commit()

    issues = create_judge_issues(
        session,
        JudgeIssueCreate(
            scene_id=scene.id,
            scene_packet_id=packet.id,
            content="林岚推门进来，守卫却低声喊她林医生。",
            required_facts=[],
            style_rules=[],
            evidence_links=[],
        ),
    )

    issue = next(item for item in issues if item.issue_type == "character_addressing_conflict")
    assert issue.severity == "medium"
    assert issue.payload["matched_text"] == "林医生"
    assert issue.payload["replacement_text"] == "林调查员"
    assert issue.payload["violation"] == {
        "type": "character_addressing_conflict",
        "canonical_name": "林岚",
        "matched_alias": "林医生",
        "allowed_aliases": ["林岚", "林调查员"],
    }
