from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import create_judge_issues
from app.domains.story_memory.models import MemoryAtomRecord


def test_judge_fails_when_dead_character_appears(session: Session) -> None:
    """已死亡角色在当前章节出场时，Judge 必须输出 timeline_conflict。"""

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
    assert issue.payload["matched_text"] == "林岚"


def test_judge_fails_when_character_appears_in_two_locations_at_same_time(session: Session) -> None:
    """同一角色同一时间出现在不同地点时，Judge 必须输出 timeline_conflict。"""

    scene, packet, book = _seed_scene(session)
    session.add(
        MemoryAtomRecord(
            book_id=book.id,
            entity_type="character",
            entity_id="林岚",
            fact_type="location",
            value="时间：午夜；地点：雾港",
            valid_from_chapter=1,
            valid_to_chapter=None,
            immutable=True,
            confidence=0.96,
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
            content="午夜，林岚在荒原城点亮信号灯。",
            required_facts=[],
            style_rules=[],
            evidence_links=[],
        ),
    )

    issue = next(item for item in issues if item.issue_type == "timeline_conflict")
    assert issue.severity == "high"
    assert issue.payload["violation"] == {
        "type": "same_time_different_location",
        "entity_id": "林岚",
        "time": "午夜",
        "expected_location": "雾港",
        "observed_location": "荒原城",
    }
    assert issue.payload["matched_text"] == "荒原城"


def test_judge_detects_chapter_18_timeline_conflict_from_chapter_17_fact(session: Session) -> None:
    """17/18 章回归：第 17 章位置事实应约束第 18 章同一时间地点。"""

    book = Book(title="十七十八章时间线", status="draft", premise="验证跨章时间线。")
    session.add(book)
    session.flush()
    previous = Chapter(book_id=book.id, ordinal=17, title="午夜雾港", status="approved", summary=None)
    target = Chapter(book_id=book.id, ordinal=18, title="荒原错位", status="draft", summary=None)
    session.add_all([previous, target])
    session.flush()
    scene = Scene(chapter_id=target.id, ordinal=1, title="荒原", status="draft", content=None)
    session.add(scene)
    session.flush()
    packet = ScenePacket(scene_id=scene.id, status="assembled", packet={"必须包含事实": [], "风格规则": []}, version=1)
    session.add(packet)
    session.add(
        MemoryAtomRecord(
            book_id=book.id,
            entity_type="character",
            entity_id="林岚",
            fact_type="location",
            value="时间：午夜；地点：雾港",
            valid_from_chapter=17,
            valid_to_chapter=None,
            immutable=True,
            confidence=0.97,
            revision=1,
            source_ref="chapter:17#memory_extract",
        )
    )
    session.commit()

    issues = create_judge_issues(
        session,
        JudgeIssueCreate(
            scene_id=scene.id,
            scene_packet_id=packet.id,
            content="第十八章午夜，林岚在荒原城点亮信号灯。",
            required_facts=[],
            style_rules=[],
            evidence_links=[],
        ),
    )

    issue = next(item for item in issues if item.issue_type == "timeline_conflict")
    assert issue.payload["violation"] == {
        "type": "same_time_different_location",
        "entity_id": "林岚",
        "time": "午夜",
        "expected_location": "雾港",
        "observed_location": "荒原城",
    }
    assert issue.payload["timeline_fact"]["source_ref"] == "chapter:17#memory_extract"


def _seed_scene(session: Session) -> tuple[Scene, ScenePacket, Book]:
    book = Book(title="时间线检测", status="draft", premise="验证时间线矛盾。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="时间线", status="draft", summary=None)
    session.add(chapter)
    session.flush()
    scene = Scene(chapter_id=chapter.id, ordinal=1, title="码头", status="draft", content=None)
    session.add(scene)
    session.flush()
    packet = ScenePacket(scene_id=scene.id, status="assembled", packet={"必须包含事实": [], "风格规则": []}, version=1)
    session.add(packet)
    session.commit()
    return scene, packet, book
