from __future__ import annotations

from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.domains.books.models import Book, Chapter, Scene
from app.domains.continuity.models import ScenePacket
from app.domains.judge.schemas import JudgeIssueCreate
from app.domains.judge.service import compute_book_style_baseline, create_judge_issues


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


def test_compute_book_style_baseline_chapter_window_limits_corpus(session: Session) -> None:
    """chapter_window 给定时只指纹化最近 N 章，避免长程全量重算。"""

    book = Book(title="窗口基线", status="draft", premise="验证文风窗口。")
    session.add(book)
    session.flush()
    # 早期章节为长说明腔（高 sentence 长度），最近章节为短句克制腔。
    early_content = "作者用一整段冗长的说明文字解释背景设定并铺陈所有动机以及世界观细节直到读者完全理解为止"
    recent_content = "雾散了。她转身。门开着。"
    for ordinal in range(1, 5):
        chapter = Chapter(book_id=book.id, ordinal=ordinal, title=f"第{ordinal}章", status="approved")
        session.add(chapter)
        session.flush()
        body = early_content if ordinal <= 2 else recent_content
        session.add(Scene(chapter_id=chapter.id, ordinal=1, title="正文", status="approved", content=body))
    session.commit()

    full = compute_book_style_baseline(session, book.id)
    windowed = compute_book_style_baseline(session, book.id, chapter_window=2)
    assert full is not None and windowed is not None
    # 窗口只取最近两章短句，平均句长应明显短于全量基线。
    assert windowed["average_sentence_length"] < full["average_sentence_length"]


def test_compute_book_style_baseline_window_none_matches_full(session: Session) -> None:
    book = Book(title="无窗口", status="draft", premise="默认全量。")
    session.add(book)
    session.flush()
    chapter = Chapter(book_id=book.id, ordinal=1, title="第1章", status="approved")
    session.add(chapter)
    session.flush()
    session.add(Scene(chapter_id=chapter.id, ordinal=1, title="正文", status="approved", content="雾散了。她转身。"))
    session.commit()

    assert compute_book_style_baseline(session, book.id) == compute_book_style_baseline(
        session, book.id, chapter_window=None
    )
