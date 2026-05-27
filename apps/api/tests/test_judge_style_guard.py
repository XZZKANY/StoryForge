from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import create_judge_issues


def test_judge_style_guard_scores_drift_against_approved_chapter_fingerprint(session: Session) -> None:
    """Judge 应从已批准章节建立文风指纹，并对后续章节明显偏离扣分。"""

    book = Book(title="雾港文风", status="draft", premise="林岚追查灯塔信号。")
    session.add(book)
    session.flush()
    approved_chapter = Chapter(
        book_id=book.id,
        ordinal=1,
        title="旧港",
        status="approved",
        summary="林岚完成旧港谈判。",
    )
    draft_chapter = Chapter(book_id=book.id, ordinal=2, title="灯塔", status="draft", summary="林岚逼近灯塔。")
    session.add_all([approved_chapter, draft_chapter])
    session.flush()
    approved_scene = Scene(
        chapter_id=approved_chapter.id,
        ordinal=1,
        title="谈判",
        status="approved",
        content="林岚按住左臂。雾从旧港退开。她没有解释，只把信号表递给副官。",
    )
    draft_scene = Scene(
        chapter_id=draft_chapter.id,
        ordinal=1,
        title="灯塔顶层",
        status="draft",
        content=None,
    )
    session.add_all([approved_scene, draft_scene])
    session.flush()
    packet = ScenePacket(scene_id=draft_scene.id, status="assembled", packet={}, version=1)
    session.add(packet)
    session.commit()

    content = "作者直接解释这座灯塔象征命运的宏大轮盘，接着用设定说明铺满整段，让读者立刻明白所有隐喻。"
    issues = create_judge_issues(
        session,
        JudgeIssueCreate(
            scene_id=draft_scene.id,
            scene_packet_id=packet.id,
            content=content,
            required_facts=[],
            style_rules=[],
            evidence_links=[],
        ),
    )

    style_issue = next(issue for issue in issues if issue.issue_type == "style_drift")
    assert style_issue.severity == "medium"
    assert style_issue.payload["style_dimension"] == "fingerprint_drift"
    assert style_issue.payload["style_score"] < style_issue.payload["style_baseline_score"]
    assert style_issue.payload["style_score"] < style_issue.payload["style_threshold"]
    assert style_issue.payload["style_fingerprint"]["source_scene_ids"] == [approved_scene.id]
    assert style_issue.payload["matched_text"] == "作者直接解释"
